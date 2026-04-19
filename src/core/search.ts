import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import matter from "gray-matter";
import { getHome, getConfig, getModelDefaults } from "./config.ts";
import { recordJobStart, recordJobComplete, recordJobFailed, getConfigValue, setConfigValue, getAllContexts } from "./db.ts";
import type { SearchResult } from "./types.ts";

export type JobTrigger = "background" | "on-demand";

// qmd is imported lazily to keep startup fast for non-search commands.
let storeInstance: any = null;
let storeCreating: Promise<any> | null = null;

/**
 * Timestamp (ms since epoch) of the last successful updateIndex() call
 * triggered from within search(). Reset to 0 whenever the store is reset.
 */
let lastIndexedAt: number = 0;

/** Reset the store singleton (for tests). */
export function resetStore() {
  storeInstance = null;
  storeCreating = null;
  lastIndexedAt = 0;
}

async function getStore() {
  if (storeInstance) return storeInstance;
  if (storeCreating) return storeCreating;

  storeCreating = (async () => {
    try {
      const { createStore } = await import("@tobilu/qmd");
      const home = getHome();

      // Configure custom models via env vars that qmd reads natively
      const config = getConfig();
      if (config.embedModel) process.env["QMD_EMBED_MODEL"] = config.embedModel;
      if (config.queryExpansionModel) process.env["QMD_GENERATE_MODEL"] = config.queryExpansionModel;
      if (config.rerankModel) process.env["QMD_RERANK_MODEL"] = config.rerankModel;

      // Build context maps for each collection from the contexts table.
      // Knotes paths like "notes/foo/bar" map to collection "notes", prefix "/foo/bar".
      // A path of just "notes" or "logs" maps to prefix "/".
      const allContexts = getAllContexts();
      const notesContext: Record<string, string> = {};
      const logsContext: Record<string, string> = {};
      for (const { path, context } of allContexts) {
        if (path === "notes") {
          notesContext["/"] = context;
        } else if (path.startsWith("notes/")) {
          notesContext["/" + path.slice("notes/".length)] = context;
        } else if (path === "logs") {
          logsContext["/"] = context;
        } else if (path.startsWith("logs/")) {
          logsContext["/" + path.slice("logs/".length)] = context;
        }
      }

      storeInstance = await createStore({
        dbPath: `${home}/.data/index.sqlite`,
        config: {
          collections: {
            notes: {
              path: `${home}/notes`,
              pattern: "**/*.md",
              ...(Object.keys(notesContext).length > 0 ? { context: notesContext } : {}),
            },
            logs: {
              path: `${home}/logs`,
              pattern: "**/*.md",
              ...(Object.keys(logsContext).length > 0 ? { context: logsContext } : {}),
            },
          },
        },
      });

      // qmd doesn't set busy_timeout, so concurrent access (e.g. embed running
      // while a search happens) can fail with SQLITE_BUSY. 30s timeout lets
      // writers wait for each other instead of failing immediately.
      storeInstance.internal.db.exec("PRAGMA busy_timeout = 30000");

      return storeInstance;
    } catch (err) {
      throw new Error(`Failed to initialize search index: ${err}`);
    } finally {
      storeCreating = null;
    }
  })();

  return storeCreating;
}

/**
 * Return the newest mtime (ms) of any .md file OR directory under the given
 * dirs. Directory mtimes are included so deletions and renames (which don't
 * change any remaining file's mtime) still trigger a reindex.
 * Returns 0 if nothing exists or directories can't be read.
 */
async function newestMdMtime(dirs: string[]): Promise<number> {
  let newest = 0;

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      const s = await stat(dir);
      if (s.mtimeMs > newest) newest = s.mtimeMs;
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          try {
            const s = await stat(fullPath);
            const mtimeMs = s.mtimeMs;
            if (mtimeMs > newest) newest = mtimeMs;
          } catch {
            // ignore stat errors
          }
        }
      })
    );
  }

  await Promise.all(dirs.map(walk));
  return newest;
}

/** Update the search index for changed files (incremental by default). */
export async function updateIndex(options?: { force?: boolean }): Promise<void> {
  const store = await getStore();
  await store.update({ force: options?.force });
}

/**
 * Build a fingerprint string from the effective embed model URI.
 * Only the embed model matters — query expansion and reranker don't affect
 * stored vectors.
 */
async function getEffectiveEmbedModelUri(): Promise<string> {
  const config = getConfig();
  if (config.embedModel) return config.embedModel;
  const defaults = await getModelDefaults();
  return defaults.embedModel;
}

/** Check if the embed model has changed since embeddings were last computed. */
export async function hasEmbedModelChanged(): Promise<boolean> {
  const current = await getEffectiveEmbedModelUri();
  const stored = getConfigValue("_embedModelFingerprint");
  return stored !== null && stored !== current;
}

/** Record the current embed model so future changes can be detected. */
async function saveEmbedModelFingerprint(): Promise<void> {
  const current = await getEffectiveEmbedModelUri();
  setConfigValue("_embedModelFingerprint", current);
}

// In-memory mutex for embed — prevents concurrent embed() calls within the
// same process (e.g. background job + manual trigger via API).
let embedRunning: Promise<void> | null = null;

/** Generate embeddings for vector search (incremental by default). */
export async function embed(options?: { force?: boolean; trigger?: JobTrigger }): Promise<void> {
  if (embedRunning) {
    await embedRunning;
    return;
  }

  // Detect embed model change — force full re-embed and reset the store
  // so it picks up the new env vars.
  let force = options?.force ?? false;
  if (await hasEmbedModelChanged()) {
    force = true;
    resetStore();
  }

  const trigger = options?.trigger ?? "on-demand";
  const jobId = recordJobStart(`embed:${trigger}`);
  const start = Date.now();
  try {
    const store = await getStore();
    let embedResult: any;
    embedRunning = store.embed({ force }).then((r: any) => { embedResult = r; }).finally(() => {
      embedRunning = null;
    });
    await embedRunning;
    await saveEmbedModelFingerprint();
    const status = await store.getStatus();
    const totalEmbedded = status.totalDocuments - status.needsEmbedding;
    recordJobComplete(jobId, Date.now() - start, {
      docsProcessed: embedResult?.docsProcessed ?? 0,
      chunksEmbedded: embedResult?.chunksEmbedded ?? 0,
      errors: embedResult?.errors ?? 0,
      totalDocuments: status.totalDocuments,
      totalEmbedded,
    });
  } catch (err: any) {
    embedRunning = null;
    recordJobFailed(jobId, err.message ?? String(err), Date.now() - start);
    throw err;
  }
}

/** Search through notes and logs. Updates the index only when files have changed. */
export async function search(
  query: string,
  options?: {
    collections?: ("notes" | "logs")[];
    limit?: number;
    mode?: "hybrid" | "bm25" | "vector";
    rerank?: boolean;
    queryExpand?: boolean;
  }
): Promise<SearchResult[]> {
  const home = getHome();
  const dirs = [join(home, "notes"), join(home, "logs")];
  const newest = await newestMdMtime(dirs);
  if (newest > lastIndexedAt) {
    await updateIndex();
    lastIndexedAt = Date.now();
  }

  const store = await getStore();
  const limit = options?.limit ?? 10;
  const collections = options?.collections && options.collections.length > 0
    ? options.collections
    : undefined;

  let results: any[];

  // All modes use store.search() with pre-built queries so results always
  // include bestChunk (the specific matching section), not just the full body.
  if (options?.mode === "bm25") {
    results = await store.search({
      queries: [{ type: "lex", query }],
      limit,
      rerank: false,
      ...(collections ? { collections } : {}),
    });
  } else if (options?.mode === "vector") {
    results = await store.search({
      queries: [{ type: "vec", query }],
      limit,
      rerank: false,
      ...(collections ? { collections } : {}),
    });
  } else {
    const config = getConfig();
    const rerank = options?.rerank ?? config.rerank;
    const queryExpand = options?.queryExpand ?? config.queryExpand;
    if (queryExpand) {
      // Full hybrid: LLM query expansion + BM25 + vector + optional reranking
      results = await store.search({
        query,
        limit,
        rerank,
        ...(collections ? { collections } : {}),
      });
    } else {
      // Fast hybrid: BM25 + vector, no LLM query expansion, optional reranking
      results = await store.search({
        queries: [
          { type: "lex", query },
          { type: "vec", query },
        ],
        limit,
        rerank,
        ...(collections ? { collections } : {}),
      });
    }
  }

  return results.map((r: any) => ({
    path: (() => {
      const abs: string = r.filepath || r.file || "";
      if (abs.startsWith(home + "/")) {
        return abs.slice(home.length + 1).replace(/\.md$/, "");
      }
      return r.displayPath?.replace(/\.md$/, "") || r.id || "";
    })(),
    title: resolveTitle(r),
    snippet: r.bestChunk || r.body || r.content || r.snippet || "",
    score: r.score || 0,
  }));
}

/**
 * qmd extracts the title from the first Markdown heading in the body. Knotes
 * writes the canonical title in YAML frontmatter and doesn't emit a heading,
 * so qmd's title is unreliable (it's the filename for notes and the latest
 * entry's `## <timestamp>` line for logs). Parse the frontmatter from the
 * returned body to get the real title. Fall back to qmd's title, then to the
 * filename basename, so callers always get a usable string.
 */
function resolveTitle(r: any): string {
  const body: string | undefined = r.body;
  if (body) {
    try {
      const data = matter(body).data as { title?: unknown };
      if (typeof data.title === "string" && data.title.length > 0) {
        return data.title;
      }
    } catch {
      // fall through to the qmd-extracted title
    }
  }
  if (typeof r.title === "string" && r.title.length > 0) return r.title;
  const dp: string = r.displayPath || "";
  return basename(dp, ".md");
}
