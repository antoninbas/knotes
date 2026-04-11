import { getHome } from "./config.ts";
import type { SearchResult } from "./types.ts";

// qmd (and its node-llama-cpp dep) is imported lazily to avoid issues
// with bun build --compile and to keep startup fast for non-search commands.
let storeInstance: any = null;

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

/** Generate embeddings for vector search (incremental by default). */
export async function embed(options?: { force?: boolean }): Promise<void> {
  const store = await getStore();
  await store.embed({ force: options?.force });
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
    results = await store.search({ query, limit, mode: "bm25" });
  } else if (options?.mode === "vector") {
    results = await store.search({ query, limit, mode: "vector" });
  } else {
    results = await store.search({ query, limit });
  }

  return results.map((r: any) => ({
    path: r.path || r.id || "",
    title: r.title || r.metadata?.title || "",
    snippet: r.content?.slice(0, 200) || r.snippet || "",
    score: r.score || 0,
  }));
}
