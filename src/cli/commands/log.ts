import type { Command } from "commander";
import { ensureHome } from "../../core/config.ts";
import {
  createLog,
  addEntry,
  listEntries,
  getEntry,
  updateEntry,
  deleteEntry,
} from "../../core/router.ts";
import { openInEditor } from "../editor.ts";
import { tmpdir } from "os";
import { join } from "path";
import { unlink } from "fs/promises";

async function getContentFromEditor(prefill?: string): Promise<string | null> {
  const tempFile = join(tmpdir(), `knotes-log-${Date.now()}.md`);
  await Bun.write(tempFile, prefill || "");
  const ok = await openInEditor(tempFile);
  if (!ok) {
    console.error("Editor exited with error");
    process.exit(1);
  }
  const content = (await Bun.file(tempFile).text()).trim();
  await unlink(tempFile).catch(() => {});
  return content || null;
}

export function registerLogCommands(program: Command): void {
  const log = program
    .command("log")
    .description("Manage logs and log entries");

  log
    .command("create")
    .description("Create a new log")
    .argument("<path>", "Logical path for the log (e.g. logs/daily)")
    .option("-t, --title <title>", "Log title")
    .action(async (path: string, opts) => {
      await ensureHome();
      await createLog(path, opts.title);
      console.log(`Created log: ${path}`);
    });

  log
    .command("add")
    .description("Add a new entry to an existing log")
    .argument("<path>", "Logical path of the log (e.g. logs/daily)")
    .option("-m, --message <message>", "Entry content")
    .action(async (path: string, opts) => {
      let content = opts.message as string | undefined;

      if (!content) {
        content = (await getContentFromEditor()) || undefined;
        if (!content) {
          console.log("Empty entry, aborting.");
          return;
        }
      }

      const entry = await addEntry(path, content);
      console.log(`Added entry ${entry.id} to ${path}`);
    });

  log
    .command("list")
    .description("List entries in a log")
    .argument("<path>", "Logical path of the log")
    .option("-l, --limit <limit>", "Maximum entries to show", "20")
    .action(async (path: string, opts) => {
      const entries = await listEntries(path, {
        limit: parseInt(opts.limit, 10),
      });
      if (entries.length === 0) {
        console.log("No entries found.");
        return;
      }
      for (const entry of entries) {
        const preview =
          entry.content.length > 80
            ? entry.content.slice(0, 80) + "..."
            : entry.content;
        const date = new Date(entry.timestamp).toLocaleString();
        console.log(`[${entry.id}] ${date}`);
        console.log(`  ${preview}\n`);
      }
    });

  log
    .command("update")
    .description("Update an existing log entry's content")
    .argument("<path>", "Logical path of the log")
    .argument("<entry-id>", "Entry ID to update (e.g. e-3f7a)")
    .option("-m, --message <message>", "New content")
    .action(async (path: string, entryId: string, opts) => {
      let content = opts.message as string | undefined;

      if (!content) {
        const existing = await getEntry(path, entryId);
        if (!existing) {
          console.error(`Entry not found: ${entryId}`);
          process.exit(1);
        }
        content = (await getContentFromEditor(existing.content)) || undefined;
        if (!content) {
          console.log("Empty content, aborting.");
          return;
        }
      }

      const entry = await updateEntry(path, entryId, content);
      console.log(`Updated entry ${entry.id} in ${path}`);
    });

  log
    .command("delete")
    .description("Delete an entry from a log")
    .argument("<path>", "Logical path of the log")
    .argument("<entry-id>", "Entry ID to delete (e.g. e-3f7a)")
    .action(async (path: string, entryId: string) => {
      await deleteEntry(path, entryId);
      console.log(`Deleted entry ${entryId} from ${path}`);
    });
}
