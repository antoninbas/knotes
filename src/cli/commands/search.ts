import type { Command } from "commander";
import { search, updateIndex, embed } from "../../core/router.ts";

export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .description("Search through notes and logs")
    .argument("<query>", "Search query")
    .option("-l, --limit <limit>", "Maximum results", "10")
    .option(
      "-m, --mode <mode>",
      "Search mode: hybrid (default), bm25, or vector",
      "hybrid"
    )
    .option("--rerank", "Enable LLM reranking (hybrid mode only, slow)")
    .option("--expand", "Enable LLM query expansion (hybrid mode only, slow)")
    .option(
      "-c, --collection <collection...>",
      "Restrict to collections: notes, logs (repeatable)"
    )
    .action(async (query: string, opts) => {
      let collections: ("notes" | "logs")[] | undefined;
      if (opts.collection) {
        const raw = Array.isArray(opts.collection) ? opts.collection : [opts.collection];
        for (const c of raw) {
          if (c !== "notes" && c !== "logs") {
            throw new Error(`Invalid collection: ${c}. Allowed: notes, logs`);
          }
        }
        collections = raw;
      }

      const results = await search(query, {
        limit: parseInt(opts.limit, 10),
        mode: opts.mode as "hybrid" | "bm25" | "vector",
        rerank: opts.rerank ? true : undefined,
        queryExpand: opts.expand ? true : undefined,
        ...(collections ? { collections } : {}),
      });

      if (results.length === 0) {
        console.log("No results found.");
        return;
      }

      for (const result of results) {
        console.log(`${result.path} (score: ${result.score.toFixed(3)})`);
        if (result.title) {
          console.log(`  ${result.title}`);
        }
        if (result.snippet) {
          console.log(
            `  ${result.snippet.slice(0, 120).replace(/\n/g, " ")}...`
          );
        }
        console.log();
      }
    });

  program
    .command("index")
    .description("Update the search index")
    .option("--force", "Force full reindex instead of incremental")
    .action(async (opts) => {
      console.log(
        opts.force ? "Rebuilding search index..." : "Updating search index..."
      );
      await updateIndex({ force: opts.force });
      console.log("Index updated.");
    });

  program
    .command("embed")
    .description("Generate embeddings for vector/hybrid search")
    .option("--force", "Recompute all embeddings instead of incremental")
    .action(async (opts) => {
      console.log("Updating search index...");
      await updateIndex();
      console.log(
        opts.force
          ? "Recomputing all embeddings..."
          : "Computing new embeddings..."
      );
      await embed({ force: opts.force });
      console.log("Embeddings updated.");
    });
}
