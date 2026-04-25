import { dirname } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { randomBytes } from "node:crypto";
import matter from "gray-matter";
import { resolvePath } from "./config.ts";
import { writeMarkdownFile, getNote, listNotes, deleteNote } from "./notes.ts";
import { updateIndex } from "./search.ts";
import { setContextValue, removeContextValue } from "./db.ts";
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
  title?: string,
  description?: string
): Promise<void> {
  if (!logicalPath.startsWith("logs/")) {
    throw new Error(`Logs must be created under logs/. Got: ${logicalPath}`);
  }

  await mkdir(dirname(resolvePath(logicalPath)), { recursive: true });
  await writeMarkdownFile(logicalPath, {
    title: title || logicalPath.split("/").pop() || "Log",
    tags: [],
    ...(description ? { description } : {}),
  });
  if (description) {
    setContextValue(logicalPath, description);
  }
  await updateIndex();
}

/** Update a log journal's metadata (title and/or description). */
export async function updateLog(
  logicalPath: string,
  opts: { title?: string; description?: string | null }
): Promise<void> {
  const filePath = resolvePath(logicalPath);
  if (!existsSync(filePath)) {
    throw new Error(`Log not found: ${logicalPath}`);
  }

  const raw = await readFile(filePath, "utf-8");
  const parsed = matter(raw);

  if (opts.title !== undefined) {
    parsed.data.title = opts.title;
  }
  if (opts.description !== undefined) {
    if (opts.description === null || opts.description === "") {
      delete parsed.data.description;
      removeContextValue(logicalPath);
    } else {
      parsed.data.description = opts.description;
      setContextValue(logicalPath, opts.description);
    }
  }

  parsed.data.modified = new Date().toISOString();
  const frontmatter = matter.stringify("", parsed.data).trim();
  const body = parsed.content ? "\n" + parsed.content : "";
  await writeFile(filePath, frontmatter + body);
  await updateIndex();
}

/** Delete an entire log journal (the file and its context entry). */
export async function deleteLog(logicalPath: string): Promise<void> {
  await deleteNote(logicalPath);
  removeContextValue(logicalPath);
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

/**
 * Insert or update a log entry sourced from an external system (e.g. GitHub).
 * Caller controls the timestamp; the entry id is provided when updating an
 * existing entry, otherwise a fresh id is minted. Order is re-sorted on every
 * call so backfilled and updated entries land in the right slot.
 */
export async function upsertEntryFromSource(
  logicalPath: string,
  opts: { entryId?: string; timestamp: string; content: string }
): Promise<LogEntry> {
  const filePath = resolvePath(logicalPath);
  if (!existsSync(filePath)) {
    throw new Error(`Log not found: ${logicalPath}. Create it first.`);
  }

  const raw = await readFile(filePath, "utf-8");
  const parsed = matter(raw);
  const entries = parseEntries(parsed.content);

  let entry: LogEntry;
  if (opts.entryId) {
    const existing = entries.find((e) => e.id === opts.entryId);
    if (existing) {
      existing.content = opts.content;
      existing.timestamp = opts.timestamp;
      entry = existing;
    } else {
      entry = { id: opts.entryId, timestamp: opts.timestamp, content: opts.content };
      entries.push(entry);
    }
  } else {
    entry = { id: generateId(), timestamp: opts.timestamp, content: opts.content };
    entries.push(entry);
  }

  entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  parsed.data.modified = nowISO();
  const frontmatter = matter.stringify("", parsed.data).trim();
  const body = serializeEntries(entries);
  await writeFile(filePath, frontmatter + "\n\n" + body);

  await updateIndex();
  return entry;
}

/**
 * Scan a log file for entries containing a `<!-- gh-event:<eventId> -->`
 * marker. Returns a map from eventId to the entry id. Used by the GitHub
 * sync engine to recover from cases where the markdown was written but the
 * synced-event DB row was lost (e.g. crash between the two operations).
 */
export async function scanGithubMarkers(
  logicalPath: string
): Promise<Map<string, string>> {
  const filePath = resolvePath(logicalPath);
  if (!existsSync(filePath)) return new Map();

  const raw = await readFile(filePath, "utf-8");
  const parsed = matter(raw);
  const entries = parseEntries(parsed.content);
  const out = new Map<string, string>();
  const re = /<!--\s*gh-event:([^\s>]+)\s*-->/;

  for (const e of entries) {
    const m = e.content.match(re);
    if (m) out.set(m[1]!, e.id);
  }
  return out;
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
