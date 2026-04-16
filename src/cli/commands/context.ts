import type { Command } from "commander";
import { listContexts, getContext, setContext, removeContext } from "../../core/router.ts";

export function registerContextCommands(program: Command): void {
  const ctx = program
    .command("context")
    .description("Manage search context hints for folders and journals");

  ctx
    .command("list")
    .description("List all context hints")
    .action(async () => {
      const entries = await listContexts();
      if (entries.length === 0) {
        console.log("No context hints set.");
        return;
      }
      for (const { path, context } of entries) {
        console.log(`${path}`);
        console.log(`  ${context}\n`);
      }
    });

  ctx
    .command("get")
    .description("Get the context hint for a path")
    .argument("<path>", "Logical path (e.g. notes/projects or logs/daily)")
    .action(async (path: string) => {
      const context = await getContext(path);
      if (context === undefined) {
        console.log(`No context set for: ${path}`);
      } else {
        console.log(context);
      }
    });

  ctx
    .command("set")
    .description("Set a context hint for a folder or journal")
    .argument("<path>", "Logical path (e.g. notes/projects or logs/daily)")
    .argument("<context>", "Context description to help search understand this folder")
    .action(async (path: string, context: string) => {
      await setContext(path, context);
      console.log(`Context set for: ${path}`);
    });

  ctx
    .command("remove")
    .description("Remove the context hint for a path")
    .argument("<path>", "Logical path (e.g. notes/projects or logs/daily)")
    .action(async (path: string) => {
      await removeContext(path);
      console.log(`Context removed for: ${path}`);
    });
}
