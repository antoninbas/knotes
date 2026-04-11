import { createStore } from "@tobilu/qmd";
import { getHome } from "./config.ts";
import type { SearchResult } from "./types.ts";

let storeInstance: Awaited<ReturnType<typeof createStore>> | null = null;

async function getStore() {
  if (storeInstance) return storeInstance;

  try {
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

/** Update the search index for changed files. */
export async function updateIndex(
  collections?: ("notes" | "logs")[]
): Promise<void> {
  const store = await getStore();
  if (collections) {
    for (const c of collections) {
      await store.update({ collections: [c] });
    }
  } else {
    await store.update();
  }
}

/** Generate embeddings for vector search. */
export async function embed(): Promise<void> {
  const store = await getStore();
  await store.embed();
}

/** Search through notes and logs. */
export async function search(
  query: string,
  options?: {
    collections?: ("notes" | "logs")[];
    limit?: number;
    mode?: "hybrid" | "bm25" | "vector";
  }
): Promise<SearchResult[]> {
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
