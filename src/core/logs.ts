import { dirname } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { randomBytes } from "node:crypto";
import matter from "gray-matter";
import { resolvePath, toLogicalPath } from "./config.ts";
import { writeMarkdownFile, getNote, listNotes } from "./notes.ts";
import { updateIndex } from "./search.ts";
import type { LogEntry, ListEntry } from "./types.ts";

const ENTRY_HEADING_RE = /^## (.+?) \{#(e-[a-f0-9]+)\}\s*$/;

function generateId(): string {
  const hex = randomBytes(8).toString("hex");
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
  if (!existsSync(filePath)) {
    throw new Error(`Log not found: ${logicalPath}. Create it first.`);
  }

  const raw = await readFile(filePath, "utf-8");
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
  await writeFile(filePath, frontmatter + "\n\n" + body);

  await updateIndex();
  return entry;
}

export async function listEntries(
  logicalPath: string,
  options?: { limit?: number; since?: string; before?: string }
): Promise<LogEntry[]> {
  const note = await getNote(logicalPath);
  let entries = parseEntries(note.content);

  if (options?.since) {
    const sinceMs = new Date(options.since).getTime();
    entries = entries.filter((e) => new Date(e.timestamp).getTime() >= sinceMs);
  }
  if (options?.before) {
    const beforeMs = new Date(options.before).getTime();
    entries = entries.filter((e) => new Date(e.timestamp).getTime() < beforeMs);
  }
  if (options?.limit) {
    entries = entries.slice(0, options.limit);
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
  const raw = await readFile(filePath, "utf-8");
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
  await writeFile(filePath, frontmatter + "\n\n" + body);

  await updateIndex();
  return entry;
}

export async function listJournals(prefix?: string): Promise<ListEntry[]> {
  const root = prefix || "logs";
  const results = await collectLogs(root);
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

async function collectLogs(prefix: string): Promise<ListEntry[]> {
  const entries = await listNotes(prefix);
  const results: ListEntry[] = [];
  for (const entry of entries) {
    if (entry.type === "log") {
      results.push(entry);
    } else if (entry.type === "directory") {
      const children = await collectLogs(entry.path);
      results.push(...children);
    }
  }
  return results;
}

export async function deleteEntry(
  logicalPath: string,
  entryId: string
): Promise<void> {
  const filePath = resolvePath(logicalPath);
  const raw = await readFile(filePath, "utf-8");
  const parsed = matter(raw);

  const entries = parseEntries(parsed.content);
  const filtered = entries.filter((e) => e.id !== entryId);

  if (filtered.length === entries.length) {
    throw new Error(`Entry not found: ${entryId}`);
  }

  parsed.data.modified = nowISO();
  const frontmatter = matter.stringify("", parsed.data).trim();
  const body = serializeEntries(filtered);
  await writeFile(filePath, frontmatter + "\n\n" + body);

  await updateIndex();
}
