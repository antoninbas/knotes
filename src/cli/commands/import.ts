import type { Command } from "commander";
import { ensureHome } from "../../core/config.ts";
import { importDocument, checkMarkitdown } from "../../core/importer.ts";

export function registerImportCommand(program: Command): void {
  program
    .command("import")
    .description("Import an external document as a note (converts to markdown)")
    .argument("<file>", "Path to the file to import")
    .option("--to <path>", "Target logical path for the imported note")
    .action(async (file: string, opts) => {
      await ensureHome();

      const available = await checkMarkitdown();
      if (!available) {
        console.error(
          "Error: markitdown is not installed.\n" +
            "Install it with: pip install 'markitdown[all]'"
        );
        process.exit(1);
      }

      console.log(`Importing ${file}...`);
      const result = await importDocument(file, { to: opts.to });
      console.log(`Imported as: ${result.path}`);
    });
}
