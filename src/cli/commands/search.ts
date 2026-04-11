import type { Command } from "commander";
import { search, updateIndex } from "../../core/search.ts";

export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .description("Search through notes and logs")
    .argument("<query>", "Search query")
    .option("-l, --limit <limit>", "Maximum results", "10")
    .option(
      "-m, --mode <mode>",
      "Search mode: hybrid, bm25, or vector",
      "hybrid"
    )
    .option("--reindex", "Re-index before searching")
    .action(async (query: string, opts) => {
      if (opts.reindex) {
        console.log("Updating index...");
        await updateIndex();
      }

      const results = await search(query, {
        limit: parseInt(opts.limit, 10),
        mode: opts.mode as "hybrid" | "bm25" | "vector",
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
    .command("reindex")
    .description("Re-index all notes and logs for search")
    .option("--embed", "Also generate embeddings for vector search")
    .action(async (opts) => {
      console.log("Updating search index...");
      await updateIndex();
      console.log("Index updated.");

      if (opts.embed) {
        console.log("Generating embeddings...");
        const { embed } = await import("../../core/search.ts");
        await embed();
        console.log("Embeddings generated.");
      }
    });
}
