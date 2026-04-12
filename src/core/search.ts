import { getHome } from "./config.ts";
import type { SearchResult } from "./types.ts";

// qmd is imported lazily to keep startup fast for non-search commands.
let storeInstance: any = null;

/** Reset the store singleton (for tests). */
export function resetStore() {
  storeInstance = null;
}

async function getStore() {
  if (storeInstance) return storeInstance;

  try {
    const { createStore } = await import("@tobilu/qmd");
    const home = getHome();

    storeInstance = await createStore({
      dbPath: `${home}/.data/index.sqlite`,
      config: {
        collections: {
          notes: {
            path: `${home}/notes`,
            pattern: "**/*.md",
          },
          logs: {
            path: `${home}/logs`,
            pattern: "**/*.md",
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
  }
}

/** Update the search index for changed files (incremental by default). */
export async function updateIndex(options?: { force?: boolean }): Promise<void> {
  const store = await getStore();
  await store.update({ force: options?.force });
}

// In-memory mutex for embed — prevents concurrent embed() calls within the
// same process (e.g. background job + manual trigger via API).
let embedRunning: Promise<void> | null = null;

/** Generate embeddings for vector search (incremental by default). */
export async function embed(options?: { force?: boolean }): Promise<void> {
  if (embedRunning) {
    await embedRunning;
    return;
  }
  const store = await getStore();
  embedRunning = store.embed({ force: options?.force }).finally(() => {
    embedRunning = null;
  });
  await embedRunning;
}

/** Search through notes and logs. Always updates the index first. */
export async function search(
  query: string,
  options?: {
    collections?: ("notes" | "logs")[];
    limit?: number;
    mode?: "hybrid" | "bm25" | "vector";
  }
): Promise<SearchResult[]> {
  await updateIndex();

  const store = await getStore();
  const limit = options?.limit ?? 10;

  let results: any[];

  if (options?.mode === "bm25") {
    results = await store.searchLex(query, { limit });
  } else if (options?.mode === "vector") {
    results = await store.searchVector(query, { limit });
  } else {
    results = await store.search({ query, limit });
  }

  return results.map((r: any) => ({
    path: r.displayPath?.replace(/\.md$/, "") || r.path || r.id || "",
    title: r.title || r.metadata?.title || "",
    snippet: r.bestChunk?.slice(0, 200) || r.body?.slice(0, 200) || r.content?.slice(0, 200) || r.snippet || "",
    score: r.score || 0,
  }));
}
