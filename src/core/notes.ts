import { mkdir, unlink, readdir, stat } from "fs/promises";
import { dirname, join, basename } from "path";
import matter from "gray-matter";
import { resolvePath, toLogicalPath, getHome } from "./config.ts";
import type {
  NoteResult,
  CreateNoteOptions,
  UpdateNoteOptions,
  NoteMeta,
} from "./types.ts";

function nowISO(): string {
  return new Date().toISOString();
}

function buildFrontmatter(meta: NoteMeta): string {
  const lines = [
    "---",
    `title: "${meta.title}"`,
    `created: ${meta.created}`,
    `modified: ${meta.modified}`,
    `tags: [${meta.tags.map((t) => `"${t}"`).join(", ")}]`,
    `type: ${meta.type}`,
    "---",
  ];
  return lines.join("\n");
}

function parseNote(filePath: string, raw: string): NoteResult {
  const parsed = matter(raw);
  const data = parsed.data as Partial<NoteMeta>;
  return {
    path: toLogicalPath(filePath),
    filePath,
    title: (data.title as string) || basename(filePath, ".md"),
    created: (data.created as string) || "",
    modified: (data.modified as string) || "",
    tags: (data.tags as string[]) || [],
    type: (data.type as "note" | "log") || "note",
    content: parsed.content.trim(),
  };
}

/**
 * Internal: write a markdown file with frontmatter. No path validation.
 * Used by both createNote and createLog.
 */
export async function writeMarkdownFile(
  logicalPath: string,
  options?: CreateNoteOptions
): Promise<NoteResult> {
  const filePath = resolvePath(logicalPath);

  if (await Bun.file(filePath).exists()) {
    throw new Error(`File already exists: ${logicalPath}`);
  }

  await mkdir(dirname(filePath), { recursive: true });

  const now = nowISO();
  const meta: NoteMeta = {
    title: options?.title || basename(logicalPath),
    created: now,
    modified: now,
    tags: options?.tags || [],
    type: logicalPath.startsWith("logs/") ? "log" : "note",
  };

  const content = options?.content || "";
  const fileContent = buildFrontmatter(meta) + "\n\n" + content + "\n";
  await Bun.write(filePath, fileContent);

  return parseNote(filePath, fileContent);
}

export async function createNote(
  logicalPath: string,
  options?: CreateNoteOptions
): Promise<NoteResult> {
  if (!logicalPath.startsWith("notes/")) {
    throw new Error(`Notes must be created under notes/. Got: ${logicalPath}`);
  }
  return writeMarkdownFile(logicalPath, options);
}

export async function getNote(logicalPath: string): Promise<NoteResult> {
  const filePath = resolvePath(logicalPath);
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    throw new Error(`Note not found: ${logicalPath}`);
  }

  const raw = await file.text();
  return parseNote(filePath, raw);
}

export async function updateNote(
  logicalPath: string,
  options: UpdateNoteOptions
): Promise<NoteResult> {
  const filePath = resolvePath(logicalPath);
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    throw new Error(`Note not found: ${logicalPath}`);
  }

  const raw = await file.text();
  const parsed = matter(raw);
  const data = parsed.data as Partial<NoteMeta>;

  const now = nowISO();
  const meta: NoteMeta = {
    title: options.title || (data.title as string) || basename(logicalPath),
    created: (data.created as string) || now,
    modified: now,
    tags: options.tags || (data.tags as string[]) || [],
    type: (data.type as "note" | "log") || "note",
  };

  const content =
    options.content !== undefined ? options.content : parsed.content.trim();
  const fileContent = buildFrontmatter(meta) + "\n\n" + content + "\n";
  await Bun.write(filePath, fileContent);

  return parseNote(filePath, fileContent);
}

/** Create a folder with a .keep file for git tracking. */
export async function createFolder(logicalPath: string): Promise<string> {
  if (!logicalPath.startsWith("notes/") && !logicalPath.startsWith("logs/")) {
    throw new Error(`Folders must be created under notes/ or logs/. Got: ${logicalPath}`);
  }

  const home = getHome();
  const dirPath = join(home, logicalPath);

  // Check if it already exists
  try {
    const s = await stat(dirPath);
    if (s.isDirectory()) {
      throw new Error(`Folder already exists: ${logicalPath}`);
    }
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
  }

  await mkdir(dirPath, { recursive: true });
  await Bun.write(join(dirPath, ".keep"), "");
  return logicalPath;
}

export async function deleteNote(logicalPath: string): Promise<void> {
  const filePath = resolvePath(logicalPath);

  if (!(await Bun.file(filePath).exists())) {
    throw new Error(`Note not found: ${logicalPath}`);
  }

  await unlink(filePath);
}

export interface ListEntry {
  path: string;
  title: string;
  type: "note" | "log" | "directory";
  modified?: string;
}

export async function listNotes(prefix?: string): Promise<ListEntry[]> {
  const home = getHome();
  const dir = prefix ? join(home, prefix) : home;
  const results: ListEntry[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden dirs/files
      if (entry.name.startsWith(".")) continue;

      if (entry.isDirectory()) {
        results.push({
          path: prefix ? `${prefix}/${entry.name}` : entry.name,
          title: entry.name,
          type: "directory",
        });
      } else if (entry.name.endsWith(".md")) {
        const filePath = join(dir, entry.name);
        try {
          const raw = await Bun.file(filePath).text();
          const parsed = matter(raw);
          const data = parsed.data as Partial<NoteMeta>;
          const logicalName = entry.name.replace(/\.md$/, "");
          results.push({
            path: prefix ? `${prefix}/${logicalName}` : logicalName,
            title: (data.title as string) || logicalName,
            type: (data.type as "note" | "log") || "note",
            modified: data.modified as string,
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Directory doesn't exist — return empty
  }

  return results.sort((a, b) => {
    // Directories first, then alphabetical
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;
    return a.path.localeCompare(b.path);
  });
}
