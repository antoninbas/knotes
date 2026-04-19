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

/**
 * Short-lived cache of newestMdMtime() so a burst of rapid searches doesn't
 * re-walk the tree for every query. TTL is tiny so deletions are still
 * picked up quickly — just enough to absorb a handful of in-flight-UI
 * queries firing in the same tick.
 */
const MTIME_CACHE_TTL_MS = 10;
let mtimeCache: { value: number; checkedAt: number } | null = null;

/** Reset the store singleton (for tests). */
export function resetStore() {
  storeInstance = null;
  storeCreating = null;
  lastIndexedAt = 0;
  mtimeCache = null;
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

/** Update the search index for changed files (always incremental; qmd hashes
 * each file and skips unchanged ones). */
export async function updateIndex(): Promise<void> {
  const store = await getStore();
  await store.update();
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
    /**
     * Drop results whose score is below this floor. Scale is mode-dependent:
     *   bm25   — sigmoid of BM25 in [0, 1); ~0.3 weak, ~0.6 medium, ~0.9 strong
     *   vector — cosine similarity in [0, 1]; ~0.3 noise floor, ~0.5 related
     *   hybrid — fused RRF score, much smaller: ~0.02–0.08 for good matches
     * Default 0 (no filtering).
     */
    minScore?: number;
  }
): Promise<SearchResult[]> {
  const home = getHome();
  const dirs = [join(home, "notes"), join(home, "logs")];
  const now = Date.now();
  let newest: number;
  if (mtimeCache && now - mtimeCache.checkedAt < MTIME_CACHE_TTL_MS) {
    newest = mtimeCache.value;
  } else {
    newest = await newestMdMtime(dirs);
    mtimeCache = { value: newest, checkedAt: now };
  }
  if (newest > lastIndexedAt) {
    // Capture the timestamp *before* the update so any file written while
    // the reindex is running will still trigger the next search to reindex.
    const startedAt = Date.now();
    await updateIndex();
    lastIndexedAt = startedAt;
  }

  const store = await getStore();
  const limit = options?.limit ?? 10;
  const collections = options?.collections && options.collections.length > 0
    ? options.collections
    : undefined;
  // searchLex/searchVector take a single-collection filter; knotes only has
  // two collections, so restrict only when the caller picked exactly one.
  const singleCollection = collections?.length === 1 ? collections[0] : undefined;

  const minScore = options?.minScore;

  let results: any[];

  if (options?.mode === "bm25") {
    // Direct BM25: raw scores in [0, 1), no chunking, single SQL statement.
    // searchLex has no minScore option in qmd, so filter post-hoc.
    results = await store.searchLex(query, {
      limit,
      ...(singleCollection ? { collection: singleCollection } : {}),
    });
    if (minScore !== undefined && minScore > 0) {
      results = results.filter((r: any) => (r.score ?? 0) >= minScore);
    }
  } else if (options?.mode === "vector") {
    // Direct vector search: raw cosine similarity, no reranking.
    // searchVector has no minScore option in qmd, so filter post-hoc.
    results = await store.searchVector(query, {
      limit,
      ...(singleCollection ? { collection: singleCollection } : {}),
    });
    if (minScore !== undefined && minScore > 0) {
      results = results.filter((r: any) => (r.score ?? 0) >= minScore);
    }
  } else {
    const config = getConfig();
    const rerank = options?.rerank ?? config.rerank;
    const queryExpand = options?.queryExpand ?? config.queryExpand;
    // `explain: true` attaches the real RRF score (weighted fusion + top-rank
    // bonus) so we can surface it instead of qmd's 1/rank position score.
    // qmd applies minScore against the fused RRF score *before* that overwrite,
    // so passing it through here filters on real relevance.
    if (queryExpand) {
      results = await store.search({
        query,
        limit,
        rerank,
        explain: true,
        ...(minScore !== undefined ? { minScore } : {}),
        ...(collections ? { collections } : {}),
      });
    } else {
      results = await store.search({
        queries: [
          { type: "lex", query },
          { type: "vec", query },
        ],
        limit,
        rerank,
        explain: true,
        ...(minScore !== undefined ? { minScore } : {}),
        ...(collections ? { collections } : {}),
      });
    }
  }

  const mode = options?.mode ?? "hybrid";
  const { extractSnippet } = await import("@tobilu/qmd");

  return results.map((r: any) => ({
    path: (() => {
      const abs: string = r.filepath || r.file || "";
      if (abs.startsWith(home + "/")) {
        return abs.slice(home.length + 1).replace(/\.md$/, "");
      }
      return r.displayPath?.replace(/\.md$/, "") || r.id || "";
    })(),
    title: resolveTitle(r),
    snippet: buildSnippet(r, query, extractSnippet),
    score: resolveScore(r, mode),
  }));
}

/**
 * qmd's hybrid/structuredSearch overwrites the fused RRF score with
 * `1 / (rank + 1)` before returning — so rank-1 always gets 1.0, rank-2 0.5,
 * etc., regardless of match quality. When we pass `explain: true` qmd still
 * reports the real fused score inside `explain.rrf.totalScore`; prefer that
 * so callers get a meaningful relevance number. searchLex/searchVector
 * already return the raw backend score in [0, 1), so use it as-is.
 */
function resolveScore(r: any, mode: "hybrid" | "bm25" | "vector"): number {
  if (mode !== "hybrid") return typeof r.score === "number" ? r.score : 0;
  const total = r?.explain?.rrf?.totalScore;
  if (typeof total === "number" && total > 0) return total;
  return typeof r.score === "number" ? r.score : 0;
}

/**
 * Build a short, query-focused excerpt. For hybrid results qmd already
 * selected a bestChunk; for searchLex/searchVector we only get the body.
 * Strip any YAML frontmatter so the excerpt never leaks "title: ..." /
 * "tags: [...]" preamble.
 */
function buildSnippet(
  r: any,
  query: string,
  extractSnippet: (body: string, query: string, maxLen?: number, chunkPos?: number, chunkLen?: number) => { snippet: string },
): string {
  const source: string = r.bestChunk || r.body || r.content || r.snippet || "";
  if (!source) return "";
  const body = stripFrontmatter(source);
  if (!body) return "";
  try {
    const chunkPos: number | undefined = typeof r.bestChunkPos === "number" ? r.bestChunkPos : undefined;
    const out = extractSnippet(body, query, 240, chunkPos);
    return out.snippet;
  } catch {
    return body.slice(0, 240);
  }
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  const after = content.slice(end + 4).replace(/^\r?\n+/, "");
  return after;
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
