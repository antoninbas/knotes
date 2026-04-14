import type { Command } from "commander";
import { ensureHome, resolvePath, getConfig } from "../../core/config.ts";
import {
  createNote,
  getNote,
  updateNote,
  deleteNote,
  listNotes,
  createFolder,
} from "../../core/router.ts";
import { openInEditor } from "../editor.ts";
import { tmpdir } from "os";
import { join } from "path";
import { unlink, readFile, writeFile } from "fs/promises";

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
        await editNoteViaTemp(result.path);
      }
    });

  note
    .command("mkdir")
    .description("Create a new folder")
    .argument("<path>", "Folder path (e.g. notes/projects)")
    .action(async (path: string) => {
      await ensureHome();
      await createFolder(path);
      console.log(`Created folder: ${path}`);
    });

  note
    .command("edit")
    .description("Open a note in your editor")
    .argument("<path>", "Logical path of the note")
    .action(async (path: string) => {
      await editNoteViaTemp(path);
    });

  note
    .command("show")
    .description("Display a note's content")
    .argument("<path>", "Logical path of the note")
    .action(async (path: string) => {
      const result = await getNote(path);
      console.log(`# ${result.title}\n`);
      console.log(result.content);
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

/**
 * Edit a note by fetching its content, writing to a temp file,
 * opening the editor, then saving back via the router.
 */
async function editNoteViaTemp(path: string): Promise<void> {
  const note = await getNote(path);
  const tempFile = join(tmpdir(), `knotes-edit-${Date.now()}.md`);
  await writeFile(tempFile, note.content);

  const ok = await openInEditor(tempFile);
  if (!ok) {
    console.error("Editor exited with error");
    await unlink(tempFile).catch(() => {});
    process.exit(1);
  }

  const newContent = await readFile(tempFile, "utf-8");
  await unlink(tempFile).catch(() => {});

  if (newContent === note.content) {
    console.log("No changes.");
    return;
  }

  await updateNote(path, { content: newContent });
  console.log(`Updated: ${path}`);
}
