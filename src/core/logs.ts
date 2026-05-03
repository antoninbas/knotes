import { dirname } from "path";
import { mkdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { randomBytes } from "node:crypto";
import matter from "gray-matter";
import { getConfig, resolvePath } from "./config.ts";
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

// --- Segment helpers ---

/**
 * Returns the filesystem path for segment N.
 * N=0 is the main file (log.md), N≥1 is a rotated segment (log.1.md, log.2.md, …).
 */
function segmentFilePath(mainPath: string, n: number): string {
  if (n === 0) return mainPath;
  return mainPath.replace(/\.md$/, `.${n}.md`);
}

/**
 * Returns all existing segment file paths in order: [main, seg1, seg2, …].
 * The main file is always included as the first element.
 */
function listSegmentFilePaths(mainPath: string): string[] {
  const paths = [mainPath];
  for (let n = 1; existsSync(segmentFilePath(mainPath, n)); n++) {
    paths.push(segmentFilePath(mainPath, n));
  }
  return paths;
}

/**
 * If log.md is at or above the configured size limit, cascade-rotate segments:
 * log.(N).md → log.(N+1).md for all N, then move log.md body → log.1.md and
 * clear log.md's body (keeping frontmatter).
 */
async function rotateMaybe(mainPath: string): Promise<void> {
  let size: number;
  try {
    size = (await stat(mainPath)).size;
  } catch {
    return;
  }
  if (size < getConfig().logSegmentMaxBytes) return;

  const raw = await readFile(mainPath, "utf-8");
  const parsed = matter(raw);
  const existingEntries = parseEntries(parsed.content);
  if (existingEntries.length === 0) return;

  // Find the current highest segment number
  let maxN = 0;
  for (let n = 1; existsSync(segmentFilePath(mainPath, n)); n++) maxN = n;

  // Cascade existing segments up: N → N+1, from highest to lowest
  for (let n = maxN; n >= 1; n--) {
    await rename(segmentFilePath(mainPath, n), segmentFilePath(mainPath, n + 1));
  }

  // Move log.md body to segment 1
  await writeFile(segmentFilePath(mainPath, 1), serializeEntries(existingEntries));

  // Clear log.md body (keep frontmatter)
  const frontmatter = matter.stringify("", parsed.data).trim();
  await writeFile(mainPath, frontmatter + "\n");
}

// --- Public API ---

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

/** Delete an entire log journal (the main file, all segments, and its context entry). */
export async function deleteLog(logicalPath: string): Promise<void> {
  // Remove segment files first
  const mainPath = resolvePath(logicalPath);
  const segPaths = listSegmentFilePaths(mainPath);
  for (let i = 1; i < segPaths.length; i++) {
    try {
      await rm(segPaths[i]!);
    } catch {
      // best-effort
    }
  }
  await deleteNote(logicalPath);
  removeContextValue(logicalPath);
}

export async function addEntry(
  logicalPath: string,
  content: string
): Promise<LogEntry> {
  const mainFilePath = resolvePath(logicalPath);
  if (!existsSync(mainFilePath)) {
    throw new Error(`Log not found: ${logicalPath}. Create it first.`);
  }

  await rotateMaybe(mainFilePath);

  const raw = await readFile(mainFilePath, "utf-8");
  const parsed = matter(raw);

  const entries = parseEntries(parsed.content);
  const entry: LogEntry = {
    id: generateId(),
    timestamp: nowISO(),
    content,
  };

  entries.unshift(entry);

  parsed.data.modified = nowISO();
  const frontmatter = matter.stringify("", parsed.data).trim();
  const body = serializeEntries(entries);
  await writeFile(mainFilePath, frontmatter + "\n\n" + body);

  await updateIndex();
  return entry;
}

/**
 * Insert or update a single log entry sourced from an external system (e.g. GitHub).
 *
 * - If `entryId` is given: scan segments in order to find and update the entry.
 *   If not found in any segment, create a new entry in log.md with the given id.
 * - If `entryId` is absent: create a new entry in log.md (after rotating if needed).
 */
export async function upsertEntryFromSource(
  logicalPath: string,
  opts: { entryId?: string; timestamp: string; content: string }
): Promise<LogEntry> {
  const mainFilePath = resolvePath(logicalPath);
  if (!existsSync(mainFilePath)) {
    throw new Error(`Log not found: ${logicalPath}. Create it first.`);
  }

  if (opts.entryId) {
    // Scan segments in order — we know the entry is there if the DB had a record for it.
    const segPaths = listSegmentFilePaths(mainFilePath);
    for (let i = 0; i < segPaths.length; i++) {
      const filePath = segPaths[i]!;
      const raw = await readFile(filePath, "utf-8");
      const isMain = i === 0;
      const parsed = isMain ? matter(raw) : null;
      const entries = parseEntries(isMain ? parsed!.content : raw);
      const idx = entries.findIndex((e) => e.id === opts.entryId);
      if (idx !== -1) {
        const entry = entries[idx]!;
        entry.content = opts.content;
        entry.timestamp = opts.timestamp;
        entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        if (isMain) {
          parsed!.data.modified = nowISO();
          const fm = matter.stringify("", parsed!.data).trim();
          await writeFile(filePath, fm + "\n\n" + serializeEntries(entries));
        } else {
          await writeFile(filePath, serializeEntries(entries));
        }
        await updateIndex();
        return entry;
      }
    }
    // Entry not found in any segment — fall through to create with the provided id
    // (edge case: crash recovery when the entry was deleted from markdown)
  }

  // New entry — always goes to log.md
  await rotateMaybe(mainFilePath);
  const raw = await readFile(mainFilePath, "utf-8");
  const parsed = matter(raw);
  const entries = parseEntries(parsed.content);
  const entry: LogEntry = {
    id: opts.entryId ?? generateId(),
    timestamp: opts.timestamp,
    content: opts.content,
  };
  entries.push(entry);
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  parsed.data.modified = nowISO();
  const fm = matter.stringify("", parsed.data).trim();
  await writeFile(mainFilePath, fm + "\n\n" + serializeEntries(entries));
  await updateIndex();
  return entry;
}

/**
 * Write multiple new log entries to log.md in a single read/write cycle.
 * All items must be new (no existing DB record). Items with an `entryId` set
 * are crash-recovery adoptions — they are treated as new inserts into log.md.
 */
export async function batchUpsertEntriesFromSource(
  logicalPath: string,
  items: Array<{ entryId?: string; timestamp: string; content: string }>
): Promise<LogEntry[]> {
  if (items.length === 0) return [];

  const mainFilePath = resolvePath(logicalPath);
  if (!existsSync(mainFilePath)) {
    throw new Error(`Log not found: ${logicalPath}. Create it first.`);
  }

  await rotateMaybe(mainFilePath);

  const raw = await readFile(mainFilePath, "utf-8");
  const parsed = matter(raw);
  const entries = parseEntries(parsed.content);

  const newEntries: LogEntry[] = [];
  for (const item of items) {
    if (item.entryId) {
      const existing = entries.find((e) => e.id === item.entryId);
      if (existing) {
        existing.content = item.content;
        existing.timestamp = item.timestamp;
        newEntries.push(existing);
        continue;
      }
    }
    const entry: LogEntry = {
      id: item.entryId ?? generateId(),
      timestamp: item.timestamp,
      content: item.content,
    };
    entries.push(entry);
    newEntries.push(entry);
  }
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  parsed.data.modified = nowISO();
  const fm = matter.stringify("", parsed.data).trim();
  await writeFile(mainFilePath, fm + "\n\n" + serializeEntries(entries));
  await updateIndex();

  return newEntries;
}

/**
 * Scan all segments for entries containing a `<!-- gh-event:<eventId> -->`
 * marker. Returns a map from eventId to entryId. Used by GitHub sync for
 * crash recovery (markdown written but DB row lost).
 */
export async function scanGithubMarkers(
  logicalPath: string
): Promise<Map<string, string>> {
  const mainFilePath = resolvePath(logicalPath);
  if (!existsSync(mainFilePath)) return new Map();

  const segPaths = listSegmentFilePaths(mainFilePath);
  const out = new Map<string, string>();
  const re = /<!--\s*gh-event:([^\s>]+)\s*-->/;

  for (let i = 0; i < segPaths.length; i++) {
    const filePath = segPaths[i]!;
    const raw = await readFile(filePath, "utf-8");
    const content = i === 0 ? matter(raw).content : raw;
    for (const e of parseEntries(content)) {
      const m = e.content.match(re);
      if (m) out.set(m[1]!, e.id);
    }
  }
  return out;
}

export async function listEntries(
  logicalPath: string,
  options?: { limit?: number; since?: string; before?: string }
): Promise<LogEntry[]> {
  const mainFilePath = resolvePath(logicalPath);
  if (!existsSync(mainFilePath)) {
    throw new Error(`Log not found: ${logicalPath}`);
  }

  const segPaths = listSegmentFilePaths(mainFilePath);
  let all: LogEntry[] = [];

  for (let i = 0; i < segPaths.length; i++) {
    const filePath = segPaths[i]!;
    const raw = await readFile(filePath, "utf-8");
    const content = i === 0 ? matter(raw).content : raw;
    all.push(...parseEntries(content));
  }

  all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (options?.since) {
    const sinceMs = new Date(options.since).getTime();
    all = all.filter((e) => new Date(e.timestamp).getTime() >= sinceMs);
  }
  if (options?.before) {
    const beforeMs = new Date(options.before).getTime();
    all = all.filter((e) => new Date(e.timestamp).getTime() < beforeMs);
  }
  if (options?.limit) {
    all = all.slice(0, options.limit);
  }
  return all;
}

export async function getEntry(
  logicalPath: string,
  entryId: string
): Promise<LogEntry | null> {
  const mainFilePath = resolvePath(logicalPath);
  const segPaths = listSegmentFilePaths(mainFilePath);

  for (let i = 0; i < segPaths.length; i++) {
    const filePath = segPaths[i]!;
    const raw = await readFile(filePath, "utf-8");
    const content = i === 0 ? matter(raw).content : raw;
    const entry = parseEntries(content).find((e) => e.id === entryId);
    if (entry) return entry;
  }
  return null;
}

/** Update an entry's content. Preserves timestamp and order. Scans all segments. */
export async function updateEntry(
  logicalPath: string,
  entryId: string,
  content: string
): Promise<LogEntry> {
  const mainFilePath = resolvePath(logicalPath);
  const segPaths = listSegmentFilePaths(mainFilePath);

  for (let i = 0; i < segPaths.length; i++) {
    const filePath = segPaths[i]!;
    const raw = await readFile(filePath, "utf-8");
    const isMain = i === 0;
    const parsed = isMain ? matter(raw) : null;
    const entries = parseEntries(isMain ? parsed!.content : raw);
    const entry = entries.find((e) => e.id === entryId);
    if (entry) {
      entry.content = content;
      if (isMain) {
        parsed!.data.modified = nowISO();
        const fm = matter.stringify("", parsed!.data).trim();
        await writeFile(filePath, fm + "\n\n" + serializeEntries(entries));
      } else {
        await writeFile(filePath, serializeEntries(entries));
      }
      await updateIndex();
      return entry;
    }
  }

  throw new Error(`Entry not found: ${entryId}`);
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
    if (entry.type === "log" && !/\.\d+$/.test(entry.path)) {
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
  const mainFilePath = resolvePath(logicalPath);
  const segPaths = listSegmentFilePaths(mainFilePath);

  for (let i = 0; i < segPaths.length; i++) {
    const filePath = segPaths[i]!;
    const raw = await readFile(filePath, "utf-8");
    const isMain = i === 0;
    const parsed = isMain ? matter(raw) : null;
    const entries = parseEntries(isMain ? parsed!.content : raw);
    const filtered = entries.filter((e) => e.id !== entryId);
    if (filtered.length < entries.length) {
      if (isMain) {
        parsed!.data.modified = nowISO();
        const fm = matter.stringify("", parsed!.data).trim();
        await writeFile(filePath, fm + "\n\n" + serializeEntries(filtered));
      } else {
        await writeFile(filePath, serializeEntries(filtered));
      }
      await updateIndex();
      return;
    }
  }

  throw new Error(`Entry not found: ${entryId}`);
}
