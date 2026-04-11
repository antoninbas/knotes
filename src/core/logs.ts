import { dirname } from "path";
import { mkdir } from "fs/promises";
import matter from "gray-matter";
import { resolvePath, toLogicalPath } from "./config.ts";
import { writeMarkdownFile, getNote } from "./notes.ts";
import { updateIndex } from "./search.ts";
import type { LogEntry } from "./types.ts";

const ENTRY_HEADING_RE = /^## (.+?) \{#(e-[a-f0-9]+)\}\s*$/;

function generateId(): string {
  const hex = Math.random().toString(16).slice(2, 6);
  return `e-${hex}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

/** Parse all entries from a log file's content (after frontmatter). */
function parseEntries(content: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const sections = content.split(/\n(?=## )/);

  for (const section of sections) {
    const lines = section.trim().split("\n");
    if (!lines[0]) continue;

    const match = lines[0].match(ENTRY_HEADING_RE);
    if (!match) continue;

    const [, timestamp, id] = match;
    const body = lines.slice(1).join("\n").trim();

    entries.push({
      id: id!,
      timestamp: timestamp!,
      content: body,
    });
  }

  return entries;
}

/** Serialize entries back to markdown content (without frontmatter). */
function serializeEntries(entries: LogEntry[]): string {
  if (entries.length === 0) return "";
  return (
    entries
      .map((e) => `## ${e.timestamp} {#${e.id}}\n\n${e.content}`)
      .join("\n\n") + "\n"
  );
}

/** Create a new log document. Throws if it already exists. */
export async function createLog(
  logicalPath: string,
  title?: string
): Promise<void> {
  if (!logicalPath.startsWith("logs/")) {
    throw new Error(`Logs must be created under logs/. Got: ${logicalPath}`);
  }

  await mkdir(dirname(resolvePath(logicalPath)), { recursive: true });
  await writeMarkdownFile(logicalPath, {
    title: title || logicalPath.split("/").pop() || "Log",
    tags: [],
  });
  await updateIndex();
}

export async function addEntry(
  logicalPath: string,
  content: string
): Promise<LogEntry> {
  const filePath = resolvePath(logicalPath);
  if (!(await Bun.file(filePath).exists())) {
    throw new Error(`Log not found: ${logicalPath}. Create it first.`);
  }

  const raw = await Bun.file(filePath).text();
  const parsed = matter(raw);

  const entries = parseEntries(parsed.content);
  const entry: LogEntry = {
    id: generateId(),
    timestamp: nowISO(),
    content,
  };

  // Prepend (newest first)
  entries.unshift(entry);

  // Update modified timestamp in frontmatter
  parsed.data.modified = nowISO();
  const frontmatter = matter.stringify("", parsed.data).trim();
  const body = serializeEntries(entries);
  await Bun.write(filePath, frontmatter + "\n\n" + body);

  await updateIndex();
  return entry;
}

export async function listEntries(
  logicalPath: string,
  options?: { limit?: number }
): Promise<LogEntry[]> {
  const note = await getNote(logicalPath);
  const entries = parseEntries(note.content);

  if (options?.limit) {
    return entries.slice(0, options.limit);
  }
  return entries;
}

export async function getEntry(
  logicalPath: string,
  entryId: string
): Promise<LogEntry | null> {
  const entries = await listEntries(logicalPath);
  return entries.find((e) => e.id === entryId) || null;
}

/** Update an entry's content. Preserves timestamp and order. */
export async function updateEntry(
  logicalPath: string,
  entryId: string,
  content: string
): Promise<LogEntry> {
  const filePath = resolvePath(logicalPath);
  const raw = await Bun.file(filePath).text();
  const parsed = matter(raw);

  const entries = parseEntries(parsed.content);
  const entry = entries.find((e) => e.id === entryId);

  if (!entry) {
    throw new Error(`Entry not found: ${entryId}`);
  }

  entry.content = content;

  parsed.data.modified = nowISO();
  const frontmatter = matter.stringify("", parsed.data).trim();
  const body = serializeEntries(entries);
  await Bun.write(filePath, frontmatter + "\n\n" + body);

  await updateIndex();
  return entry;
}

export async function deleteEntry(
  logicalPath: string,
  entryId: string
): Promise<void> {
  const filePath = resolvePath(logicalPath);
  const raw = await Bun.file(filePath).text();
  const parsed = matter(raw);

  const entries = parseEntries(parsed.content);
  const filtered = entries.filter((e) => e.id !== entryId);

  if (filtered.length === entries.length) {
    throw new Error(`Entry not found: ${entryId}`);
  }

  parsed.data.modified = nowISO();
  const frontmatter = matter.stringify("", parsed.data).trim();
  const body = serializeEntries(filtered);
  await Bun.write(filePath, frontmatter + "\n\n" + body);

  await updateIndex();
}
