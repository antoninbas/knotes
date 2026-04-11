import type { Command } from "commander";
import { ensureHome } from "../../core/config.ts";
import { importDocument } from "../../core/router.ts";

export function registerImportCommand(program: Command): void {
  program
    .command("import")
    .description("Import an external document as a note (converts to markdown)")
    .argument("<file>", "Path to the file to import")
    .option("--to <path>", "Target logical path for the imported note")
    .action(async (file: string, opts) => {
      await ensureHome();
      console.log(`Importing ${file}...`);
      const result = await importDocument(file, { to: opts.to });
      console.log(`Imported as: ${result.path}`);
    });
}
