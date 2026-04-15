/**
 * Router — returns the right implementation (direct or HTTP client)
 * based on whether a server is running and the serverless config.
 */

import { getConfig } from "./config.ts";
import { shouldUseServer, requireServer } from "./client.ts";
import * as client from "./client.ts";
import * as directNotes from "./notes.ts";
import * as directLogs from "./logs.ts";
import * as directSearch from "./search.ts";
import * as directImporter from "./importer.ts";
import type { NoteResult, LogEntry, SearchResult, SearchMode, CreateNoteOptions, UpdateNoteOptions } from "./types.ts";
import type { ListEntry } from "./notes.ts";

function useServer(): boolean {
  const config = getConfig();
  if (config.serverless) return false;

  if (shouldUseServer(config.serverless)) return true;

  // Not serverless, but no server running — fail
  requireServer();
  return false; // unreachable, requireServer throws
}

// --- Notes ---

export async function createNote(path: string, opts?: CreateNoteOptions): Promise<NoteResult> {
  if (useServer()) return client.createNote(path, opts);
  return directNotes.createNote(path, opts);
}

export async function getNote(path: string): Promise<NoteResult> {
  if (useServer()) return client.getNote(path);
  return directNotes.getNote(path);
}

export async function updateNote(path: string, opts: UpdateNoteOptions): Promise<NoteResult> {
  if (useServer()) return client.updateNote(path, opts);
  return directNotes.updateNote(path, opts);
}

export async function deleteNote(path: string): Promise<void> {
  if (useServer()) return client.deleteNote(path);
  return directNotes.deleteNote(path);
}

export async function listNotes(prefix?: string): Promise<ListEntry[]> {
  if (useServer()) return client.listNotes(prefix);
  return directNotes.listNotes(prefix);
}

export async function createFolder(path: string): Promise<void> {
  if (useServer()) { await client.createFolder(path); return; }
  await directNotes.createFolder(path);
}

// --- Logs ---

export async function createLog(path: string, title?: string): Promise<void> {
  if (useServer()) return client.createLog(path, title);
  return directLogs.createLog(path, title);
}

export async function addEntry(path: string, content: string): Promise<LogEntry> {
  if (useServer()) return client.addEntry(path, content);
  return directLogs.addEntry(path, content);
}

export async function listEntries(path: string, opts?: { limit?: number }): Promise<LogEntry[]> {
  if (useServer()) return client.listEntries(path, opts);
  return directLogs.listEntries(path, opts);
}

export async function getEntry(path: string, entryId: string): Promise<LogEntry | null> {
  if (useServer()) {
    // No dedicated endpoint — get all entries and find
    const entries = await client.listEntries(path);
    return entries.find((e) => e.id === entryId) || null;
  }
  return directLogs.getEntry(path, entryId);
}

export async function updateEntry(path: string, entryId: string, content: string): Promise<LogEntry> {
  if (useServer()) return client.updateEntry(path, entryId, content);
  return directLogs.updateEntry(path, entryId, content);
}

export async function deleteEntry(path: string, entryId: string): Promise<void> {
  if (useServer()) return client.deleteEntry(path, entryId);
  return directLogs.deleteEntry(path, entryId);
}

// --- Search ---

export async function search(
  query: string,
  opts?: { limit?: number; mode?: SearchMode }
): Promise<SearchResult[]> {
  if (useServer()) return client.search(query, opts);
  return directSearch.search(query, opts);
}

export async function updateIndex(opts?: { force?: boolean }): Promise<void> {
  if (useServer()) return client.updateIndex(opts);
  return directSearch.updateIndex(opts);
}

export async function embed(opts?: { force?: boolean }): Promise<void> {
  if (useServer()) return client.embed(opts);
  return directSearch.embed(opts);
}

// --- Import ---

export async function importDocument(filePath: string, opts?: { to?: string }): Promise<NoteResult> {
  if (useServer()) return client.importDocument(filePath, opts);
  const available = await directImporter.checkMarkitdown();
  if (!available) {
    throw new Error("markitdown is not installed. Install with: pip install 'markitdown[all]'");
  }
  return directImporter.importDocument(filePath, opts);
}
