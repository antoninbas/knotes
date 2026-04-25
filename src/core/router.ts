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
import * as directContext from "./context.ts";
import * as directGhConnections from "./github/connections.ts";
import * as directGhAuth from "./github/auth.ts";
import * as directGhSync from "./github/sync.ts";
import type { NoteResult, LogEntry, SearchResult, SearchMode, CreateNoteOptions, UpdateNoteOptions, ListEntry } from "./types.ts";
import type { GhAccount, GhBodyMode, GhConnection, GhMonitor, GhSyncResult } from "./github/types.ts";

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

export async function deleteFolder(path: string): Promise<void> {
  if (useServer()) return client.deleteFolder(path);
  return directNotes.deleteFolder(path);
}

export async function renameNote(oldPath: string, newPath: string): Promise<NoteResult> {
  if (useServer()) return client.renameNote(oldPath, newPath);
  return directNotes.renameNote(oldPath, newPath);
}

export async function renameFolder(oldPath: string, newPath: string): Promise<void> {
  if (useServer()) return client.renameFolder(oldPath, newPath);
  return directNotes.renameFolder(oldPath, newPath);
}

// --- Logs ---

export async function listJournals(prefix?: string): Promise<ListEntry[]> {
  if (useServer()) return client.listJournals(prefix);
  return directLogs.listJournals(prefix);
}

export async function createLog(path: string, title?: string, description?: string): Promise<void> {
  if (useServer()) return client.createLog(path, title, description);
  return directLogs.createLog(path, title, description);
}

export async function updateLog(path: string, opts: { title?: string; description?: string | null }): Promise<void> {
  if (useServer()) return client.updateLog(path, opts);
  return directLogs.updateLog(path, opts);
}

export async function deleteLog(path: string): Promise<void> {
  if (useServer()) return client.deleteLog(path);
  return directLogs.deleteLog(path);
}

export async function addEntry(path: string, content: string): Promise<LogEntry> {
  if (useServer()) return client.addEntry(path, content);
  return directLogs.addEntry(path, content);
}

export async function listEntries(path: string, opts?: { limit?: number; since?: string; before?: string }): Promise<LogEntry[]> {
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
  opts?: { limit?: number; mode?: SearchMode; rerank?: boolean; queryExpand?: boolean; collections?: ("notes" | "logs")[]; minScore?: number }
): Promise<SearchResult[]> {
  if (useServer()) return client.search(query, opts);
  return directSearch.search(query, opts);
}

export async function updateIndex(): Promise<void> {
  if (useServer()) return client.updateIndex();
  return directSearch.updateIndex();
}

export async function embed(opts?: { force?: boolean }): Promise<void> {
  if (useServer()) return client.embed(opts);
  return directSearch.embed(opts);
}

// --- Context ---

export async function listContexts(): Promise<{ path: string; context: string }[]> {
  if (useServer()) return client.listContexts();
  return directContext.listContexts();
}

export async function getContext(path: string): Promise<string | undefined> {
  if (useServer()) return client.getContext(path);
  return directContext.getContext(path);
}

export async function setContext(path: string, context: string): Promise<void> {
  if (useServer()) return client.setContext(path, context);
  return directContext.setContext(path, context);
}

export async function removeContext(path: string): Promise<void> {
  if (useServer()) return client.removeContext(path);
  return directContext.removeContext(path);
}

// --- GitHub ---

export async function listGithubAccounts(): Promise<GhAccount[]> {
  if (useServer()) return client.listGithubAccounts();
  return directGhConnections.listAccounts();
}

export async function loginGithubPat(host: string, token: string): Promise<GhAccount> {
  if (useServer()) return client.loginGithubPat(host, token);
  return directGhAuth.loginPat(host, token);
}

export async function loginGithubGhCli(host: string): Promise<GhAccount> {
  if (useServer()) return client.loginGithubGhCli(host);
  return directGhAuth.loginGhCli(host);
}

export async function logoutGithub(host: string, login: string): Promise<void> {
  if (useServer()) return client.logoutGithub(host, login);
  return directGhConnections.logout(host, login);
}

export async function listGithubConnections(logPath?: string): Promise<GhConnection[]> {
  if (useServer()) return client.listGithubConnections(logPath);
  return directGhConnections.listConnections(logPath);
}

export interface AddGithubConnectionInput {
  logPath: string;
  host: string;
  login: string;
  monitors: GhMonitor[];
  includeOrgs?: string[];
  excludeOrgs?: string[];
  includeRepos?: string[];
  excludeRepos?: string[];
  since?: string;
  bodyMode?: GhBodyMode;
  bodyMaxChars?: number | null;
}

export async function addGithubConnection(input: AddGithubConnectionInput): Promise<GhConnection> {
  if (useServer()) return client.addGithubConnection(input);
  return directGhConnections.addConnection(input);
}

export async function removeGithubConnection(id: number): Promise<void> {
  if (useServer()) return client.removeGithubConnection(id);
  return directGhConnections.removeConnection(id);
}

export async function syncGithub(opts?: {
  logPath?: string;
  connectionId?: number;
}): Promise<GhSyncResult[]> {
  if (useServer()) return client.syncGithub(opts);
  if (opts?.connectionId !== undefined) {
    return [await directGhSync.syncConnection(opts.connectionId)];
  }
  if (opts?.logPath) return directGhSync.syncForLog(opts.logPath);
  return directGhSync.syncAll();
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
