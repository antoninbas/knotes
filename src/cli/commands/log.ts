import type { Command } from "commander";
import { ensureHome } from "../../core/config.ts";
import {
  createLog,
  updateLog,
  deleteLog,
  addEntry,
  listEntries,
  listJournals,
  getEntry,
  updateEntry,
  deleteEntry,
  renameNote,
} from "../../core/router.ts";
import { openInEditor } from "../editor.ts";
import { tmpdir } from "os";
import { join } from "path";
import { unlink, readFile, writeFile } from "fs/promises";

async function getContentFromEditor(prefill?: string): Promise<string | null> {
  const tempFile = join(tmpdir(), `knotes-log-${Date.now()}.md`);
  await writeFile(tempFile, prefill || "");
  const ok = await openInEditor(tempFile);
  if (!ok) {
    console.error("Editor exited with error");
    process.exit(1);
  }
  const content = (await readFile(tempFile, "utf-8")).trim();
  await unlink(tempFile).catch(() => {});
  return content || null;
}

export function registerLogCommands(program: Command): void {
  const log = program
    .command("log")
    .description("Manage logs and log entries");

  log
    .command("list-journals")
    .description("List all journals (log documents)")
    .argument("[prefix]", "Filter to a sub-path (e.g. logs/work)")
    .action(async (prefix?: string) => {
      await ensureHome();
      const journals = await listJournals(prefix);
      if (journals.length === 0) {
        console.log("No journals found.");
        return;
      }
      for (const j of journals) {
        console.log(`${j.path}  ${j.title}`);
      }
    });

  log
    .command("create-journal")
    .description("Create a new log journal")
    .argument("<path>", "Logical path for the log (e.g. logs/daily)")
    .option("-t, --title <title>", "Log title")
    .option("-d, --description <description>", "Journal description (used as search context)")
    .action(async (path: string, opts) => {
      await ensureHome();
      await createLog(path, opts.title, opts.description);
      console.log(`Created log: ${path}`);
    });

  log
    .command("update-journal")
    .description("Update a log journal's title or description")
    .argument("<path>", "Logical path of the journal (e.g. logs/daily)")
    .option("-t, --title <title>", "New title")
    .option("-d, --description <description>", "New description (use empty string to clear)")
    .action(async (path: string, opts) => {
      const updates: { title?: string; description?: string | null } = {};
      if (opts.title !== undefined) updates.title = opts.title;
      if (opts.description !== undefined) {
        updates.description = opts.description === "" ? null : opts.description;
      }
      if (Object.keys(updates).length === 0) {
        console.error("Provide at least --title or --description");
        process.exit(1);
      }
      await updateLog(path, updates);
      console.log(`Updated journal: ${path}`);
    });

  log
    .command("delete-journal")
    .description("Delete an entire log journal")
    .argument("<path>", "Logical path of the journal (e.g. logs/daily)")
    .action(async (path: string) => {
      await deleteLog(path);
      console.log(`Deleted journal: ${path}`);
    });

  log
    .command("rename-journal")
    .description("Rename or move a journal (must stay under logs/)")
    .argument("<from>", "Current logical path")
    .argument("<to>", "New logical path")
    .action(async (from: string, to: string) => {
      const result = await renameNote(from, to);
      console.log(`Renamed journal: ${from} → ${result.path}`);
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
    .option("--since <date>", "Only show entries at or after this date/time (ISO 8601 or any parseable date)")
    .option("--before <date>", "Only show entries before this date/time (ISO 8601 or any parseable date)")
    .action(async (path: string, opts) => {
      const entries = await listEntries(path, {
        limit: parseInt(opts.limit, 10),
        since: opts.since,
        before: opts.before,
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
