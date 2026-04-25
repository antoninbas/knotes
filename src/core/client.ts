/**
 * HTTP client for routing CLI/MCP operations through the running server.
 * Mirrors the core API but makes HTTP requests instead of direct file I/O.
 */

import { getServerInfo, isServerAlive } from "./db.ts";
import type { NoteResult, LogEntry, SearchResult, SearchMode, CreateNoteOptions, UpdateNoteOptions, ListEntry } from "./types.ts";
import type { GhAccount, GhBodyMode, GhConnection, GhMonitor, GhSyncResult } from "./github/types.ts";

function getBaseUrl(): string {
  const info = getServerInfo();
  if (!info) throw new Error("No server info found");
  return `http://${info.hostname}:${info.port}/api`;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Server error: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Check if we should route through the server.
 * Returns true if the server is alive and we're not in serverless mode.
 */
export function shouldUseServer(serverless: boolean): boolean {
  if (serverless) return false;
  return isServerAlive();
}

/**
 * Verify the server is reachable. Call this before routing commands.
 * Throws a helpful error if the server is expected but not available.
 */
export function requireServer(): void {
  if (!isServerAlive()) {
    throw new Error(
      "No running Knotes server found.\n" +
      "Start a server with: knotes server\n" +
      "Or enable serverless mode: knotes config set serverless true"
    );
  }
}

// --- Notes ---

export async function createNote(path: string, opts?: CreateNoteOptions): Promise<NoteResult> {
  return request<NoteResult>("/notes", {
    method: "POST",
    body: JSON.stringify({ path, ...opts }),
  });
}

export async function getNote(path: string): Promise<NoteResult> {
  return request<NoteResult>(`/notes/get?path=${encodeURIComponent(path)}`);
}

export async function updateNote(path: string, opts: UpdateNoteOptions): Promise<NoteResult> {
  return request<NoteResult>("/notes", {
    method: "PUT",
    body: JSON.stringify({ path, ...opts }),
  });
}

export async function deleteNote(path: string): Promise<void> {
  await request(`/notes?path=${encodeURIComponent(path)}`, { method: "DELETE" });
}

export async function listNotes(prefix?: string): Promise<ListEntry[]> {
  return request<ListEntry[]>(`/notes?${prefix ? `prefix=${encodeURIComponent(prefix)}` : ""}`);
}

export async function createFolder(path: string): Promise<void> {
  await request("/notes/folder", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export async function deleteFolder(path: string): Promise<void> {
  await request(`/notes/folder?path=${encodeURIComponent(path)}`, { method: "DELETE" });
}

export async function renameNote(oldPath: string, newPath: string): Promise<NoteResult> {
  return request<NoteResult>("/notes/rename", {
    method: "POST",
    body: JSON.stringify({ oldPath, newPath }),
  });
}

export async function renameFolder(oldPath: string, newPath: string): Promise<void> {
  await request("/notes/folder/rename", {
    method: "POST",
    body: JSON.stringify({ oldPath, newPath }),
  });
}

// --- Logs ---

export async function listJournals(prefix?: string): Promise<ListEntry[]> {
  return request<ListEntry[]>(`/logs?${prefix ? `prefix=${encodeURIComponent(prefix)}` : ""}`);
}

export async function createLog(path: string, title?: string, description?: string): Promise<void> {
  await request("/logs", {
    method: "POST",
    body: JSON.stringify({ path, title, description }),
  });
}

export async function updateLog(path: string, opts: { title?: string; description?: string | null }): Promise<void> {
  await request("/logs", {
    method: "PUT",
    body: JSON.stringify({ path, ...opts }),
  });
}

export async function deleteLog(path: string): Promise<void> {
  await request(`/logs?path=${encodeURIComponent(path)}`, { method: "DELETE" });
}

export async function addEntry(path: string, content: string): Promise<LogEntry> {
  return request<LogEntry>("/logs/entries", {
    method: "POST",
    body: JSON.stringify({ path, content }),
  });
}

export async function listEntries(path: string, opts?: { limit?: number; since?: string; before?: string }): Promise<LogEntry[]> {
  const params = new URLSearchParams({ path });
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.since) params.set("since", opts.since);
  if (opts?.before) params.set("before", opts.before);
  return request<LogEntry[]>(`/logs/entries?${params.toString()}`);
}

export async function updateEntry(path: string, entryId: string, content: string): Promise<LogEntry> {
  return request<LogEntry>("/logs/entries", {
    method: "PUT",
    body: JSON.stringify({ path, entryId, content }),
  });
}

export async function deleteEntry(path: string, entryId: string): Promise<void> {
  await request(
    `/logs/entries?path=${encodeURIComponent(path)}&entryId=${encodeURIComponent(entryId)}`,
    { method: "DELETE" }
  );
}

// --- Search ---

export async function search(
  query: string,
  opts?: { limit?: number; mode?: SearchMode; rerank?: boolean; queryExpand?: boolean; collections?: ("notes" | "logs")[]; minScore?: number }
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts?.mode) params.set("mode", opts.mode);
  if (opts?.rerank !== undefined) params.set("rerank", String(opts.rerank));
  if (opts?.queryExpand !== undefined) params.set("queryExpand", String(opts.queryExpand));
  if (opts?.collections && opts.collections.length > 0) params.set("collections", opts.collections.join(","));
  if (opts?.minScore !== undefined) params.set("minScore", String(opts.minScore));
  return request<SearchResult[]>(`/search?${params}`);
}

export async function updateIndex(): Promise<void> {
  await request("/search/index", { method: "POST", body: "{}" });
}

export async function embed(opts?: { force?: boolean }): Promise<void> {
  await request("/search/embed", {
    method: "POST",
    body: JSON.stringify({ force: opts?.force }),
  });
}

export async function notifyConfigChanged(): Promise<{ actions: string[] }> {
  return request("/config/notify", { method: "POST" });
}

// --- Context ---

export async function listContexts(): Promise<{ path: string; context: string }[]> {
  return request("/context");
}

export async function getContext(path: string): Promise<string | undefined> {
  const res = await request<{ context: string | null }>(`/context/get?path=${encodeURIComponent(path)}`);
  return res.context ?? undefined;
}

export async function setContext(path: string, context: string): Promise<void> {
  await request("/context", {
    method: "PUT",
    body: JSON.stringify({ path, context }),
  });
}

export async function removeContext(path: string): Promise<void> {
  await request(`/context?path=${encodeURIComponent(path)}`, { method: "DELETE" });
}

// --- Import ---

export async function importDocument(filePath: string, opts?: { to?: string }): Promise<NoteResult> {
  return request<NoteResult>("/notes/import", {
    method: "POST",
    body: JSON.stringify({ filePath, to: opts?.to }),
  });
}

// --- GitHub ---

export async function listGithubAccounts(): Promise<GhAccount[]> {
  return request<GhAccount[]>("/github/accounts");
}

export async function logoutGithub(host: string, login: string): Promise<void> {
  await request("/github/accounts", {
    method: "DELETE",
    body: JSON.stringify({ host, login }),
  });
}

export async function loginGithubPat(host: string, token: string): Promise<GhAccount> {
  return request<GhAccount>("/github/auth/pat", {
    method: "POST",
    body: JSON.stringify({ host, token }),
  });
}

export async function loginGithubGhCli(host: string): Promise<GhAccount> {
  return request<GhAccount>("/github/auth/gh-cli", {
    method: "POST",
    body: JSON.stringify({ host }),
  });
}

export async function listGithubConnections(logPath?: string): Promise<GhConnection[]> {
  const q = logPath ? `?logPath=${encodeURIComponent(logPath)}` : "";
  return request<GhConnection[]>(`/github/connections${q}`);
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
  return request<GhConnection>("/github/connections", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function removeGithubConnection(id: number): Promise<void> {
  await request(`/github/connections/${id}`, { method: "DELETE" });
}

export async function syncGithub(opts?: {
  logPath?: string;
  connectionId?: number;
}): Promise<GhSyncResult[]> {
  return request<GhSyncResult[]>("/github/sync", {
    method: "POST",
    body: JSON.stringify(opts ?? {}),
  });
}
