import type { Command } from "commander";
import { ensureHome, resolvePath } from "../../core/config.ts";
import {
  createNote,
  getNote,
  updateNote,
  deleteNote,
  listNotes,
} from "../../core/notes.ts";
import { openInEditor } from "../editor.ts";

export function registerNoteCommands(program: Command): void {
  const note = program
    .command("note")
    .description("Manage notes");

  note
    .command("create")
    .description("Create a new note")
    .argument("<path>", "Logical path for the note (e.g. notes/projects/foo)")
    .option("-t, --title <title>", "Note title")
    .option("--tags <tags>", "Comma-separated tags")
    .option("-e, --edit", "Open in editor after creating")
    .action(async (path: string, opts) => {
      await ensureHome();
      const tags = opts.tags
        ? (opts.tags as string).split(",").map((t: string) => t.trim())
        : undefined;
      const result = await createNote(path, {
        title: opts.title,
        tags,
      });
      console.log(`Created: ${result.path}`);

      if (opts.edit) {
        await openInEditor(result.filePath);
      }
    });

  note
    .command("edit")
    .description("Open a note in your editor")
    .argument("<path>", "Logical path of the note")
    .action(async (path: string) => {
      const filePath = resolvePath(path);
      const ok = await openInEditor(filePath);
      if (!ok) {
        console.error("Editor exited with error");
        process.exit(1);
      }
    });

  note
    .command("show")
    .description("Display a note's content")
    .argument("<path>", "Logical path of the note")
    .option("--raw", "Show raw markdown including frontmatter")
    .action(async (path: string, opts) => {
      const result = await getNote(path);
      if (opts.raw) {
        const raw = await Bun.file(result.filePath).text();
        console.log(raw);
      } else {
        console.log(`# ${result.title}\n`);
        console.log(result.content);
      }
    });

  note
    .command("delete")
    .description("Delete a note")
    .argument("<path>", "Logical path of the note")
    .action(async (path: string) => {
      await deleteNote(path);
      console.log(`Deleted: ${path}`);
    });

  note
    .command("list")
    .description("List notes and directories")
    .argument("[prefix]", "Path prefix to list under")
    .action(async (prefix?: string) => {
      await ensureHome();
      const entries = await listNotes(prefix);
      if (entries.length === 0) {
        console.log("No entries found.");
        return;
      }
      for (const entry of entries) {
        const icon =
          entry.type === "directory" ? "📁" : entry.type === "log" ? "📋" : "📄";
        console.log(`${icon} ${entry.path}  ${entry.title !== entry.path.split("/").pop() ? `(${entry.title})` : ""}`);
      }
    });
}
