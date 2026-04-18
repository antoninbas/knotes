import { mkdir, unlink, readdir, stat, readFile, writeFile, rm } from "fs/promises";
import { existsSync, readdirSync } from "fs";
import { dirname, join, basename } from "path";
import matter from "gray-matter";
import { resolvePath, toLogicalPath, getHome } from "./config.ts";
import { updateIndex } from "./search.ts";

/**
 * Mirror of qmd's handelize() for a single path segment. qmd lowercases and
 * replaces every run of non-[letter/digit/$] characters with a single dash
 * while preserving the file extension for the final segment. We reimplement
 * rather than import because qmd only exports the function from its internal
 * module, not from the package root.
 */
function handelizeSegment(segment: string, isFile: boolean): string | null {
  if (!segment) return null;
  const lower = segment.toLowerCase();
  if (isFile) {
    const extMatch = lower.match(/(\.[a-z0-9]+)$/);
    const ext = extMatch ? extMatch[1]! : "";
    const nameWithoutExt = ext ? lower.slice(0, -ext.length) : lower;
    if (!/[\p{L}\p{N}$]/u.test(nameWithoutExt)) return null;
    const cleaned = nameWithoutExt.replace(/[^\p{L}\p{N}$]+/gu, "-").replace(/^-+|-+$/g, "");
    return cleaned + ext;
  }
  if (!/[\p{L}\p{N}$]/u.test(lower)) return null;
  return lower.replace(/[^\p{L}\p{N}$]+/gu, "-").replace(/^-+|-+$/g, "");
}
import type {
  NoteResult,
  CreateNoteOptions,
  UpdateNoteOptions,
  NoteMeta,
  ListEntry,
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
  ];
  if (meta.description) {
    lines.push(`description: "${meta.description.replace(/"/g, '\\"')}"`);
  }
  lines.push("---");
  return lines.join("\n");
}

function parseNote(filePath: string, raw: string): NoteResult {
  const parsed = matter(raw);
  const data = parsed.data as Partial<NoteMeta>;
  const result: NoteResult = {
    path: toLogicalPath(filePath),
    filePath,
    title: (data.title as string) || basename(filePath, ".md"),
    created: (data.created as string) || "",
    modified: (data.modified as string) || "",
    tags: (data.tags as string[]) || [],
    type: (data.type as "note" | "log") || "note",
    content: parsed.content.trim(),
  };
  if (data.description) {
    result.description = data.description as string;
  }
  return result;
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

  if (existsSync(filePath)) {
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
    ...(options?.description ? { description: options.description } : {}),
  };

  const content = options?.content || "";
  const fileContent = buildFrontmatter(meta) + "\n\n" + content + "\n";
  await writeFile(filePath, fileContent);

  return parseNote(filePath, fileContent);
}

export async function createNote(
  logicalPath: string,
  options?: CreateNoteOptions
): Promise<NoteResult> {
  if (!logicalPath.startsWith("notes/")) {
    throw new Error(`Notes must be created under notes/. Got: ${logicalPath}`);
  }
  const result = await writeMarkdownFile(logicalPath, options);
  await updateIndex();
  return result;
}

/**
 * Resolve a logical path to the actual file on disk. qmd handelize()s paths
 * when indexing — lowercasing and replacing non-alphanumeric runs with `-`,
 * so a search result for "Mixed Case With Spaces.md" comes back as
 * "notes/odd-names/mixed-case-with-spaces". An exact path lookup misses the
 * on-disk file; we have to walk the segments and pick the entry whose own
 * handelized form matches each requested segment.
 *
 * Returns null if no matching file exists.
 */
function resolveExistingPath(logicalPath: string): string | null {
  const direct = resolvePath(logicalPath);
  if (existsSync(direct)) return direct;

  const home = getHome();
  const cleaned = logicalPath.replace(/\.md$/, "");
  const segments = cleaned.split("/").filter(Boolean);
  const lastIdx = segments.length - 1;
  let current = home;

  for (let i = 0; i < segments.length; i++) {
    const target = segments[i]!;
    const isFile = i === lastIdx;
    const expected = isFile ? `${target}.md` : target;

    let match: string | undefined;
    try {
      match = readdirSync(current).find((entry) => {
        if (isFile && !entry.endsWith(".md")) return false;
        if (entry === expected) return true;
        const handelized = handelizeSegment(entry, isFile);
        return handelized !== null && handelized === expected;
      });
    } catch {
      return null;
    }

    if (!match) return null;
    current = join(current, match);
  }

  return current;
}

export async function getNote(logicalPath: string): Promise<NoteResult> {
  const filePath = resolveExistingPath(logicalPath);
  if (!filePath) throw new Error(`Note not found: ${logicalPath}`);

  const raw = await readFile(filePath, "utf-8");
  return parseNote(filePath, raw);
}

export async function updateNote(
  logicalPath: string,
  options: UpdateNoteOptions
): Promise<NoteResult> {
  const filePath = resolveExistingPath(logicalPath);
  if (!filePath) throw new Error(`Note not found: ${logicalPath}`);

  const raw = await readFile(filePath, "utf-8");
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
  await writeFile(filePath, fileContent);

  const result = parseNote(filePath, fileContent);
  await updateIndex();
  return result;
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
  await writeFile(join(dirPath, ".keep"), "");
  return logicalPath;
}

/** Delete a folder and all its contents. */
export async function deleteFolder(logicalPath: string): Promise<void> {
  if (!logicalPath.startsWith("notes/") && !logicalPath.startsWith("logs/")) {
    throw new Error(`Can only delete folders under notes/ or logs/. Got: ${logicalPath}`);
  }

  const home = getHome();
  const dirPath = join(home, logicalPath);

  try {
    const s = await stat(dirPath);
    if (!s.isDirectory()) {
      throw new Error(`Not a folder: ${logicalPath}`);
    }
  } catch (err: any) {
    if (err.code === "ENOENT") throw new Error(`Folder not found: ${logicalPath}`);
    throw err;
  }

  await rm(dirPath, { recursive: true, force: true });
  await updateIndex();
}

export async function deleteNote(logicalPath: string): Promise<void> {
  const filePath = resolveExistingPath(logicalPath);
  if (!filePath) throw new Error(`Note not found: ${logicalPath}`);

  await unlink(filePath);
  await updateIndex();
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
          const raw = await readFile(filePath, "utf-8");
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
