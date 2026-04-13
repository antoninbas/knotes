/**
 * HTTP client for routing CLI/MCP operations through the running server.
 * Mirrors the core API but makes HTTP requests instead of direct file I/O.
 */

import { getServerInfo, isServerAlive } from "./db.ts";
import type { NoteResult, LogEntry, SearchResult, CreateNoteOptions, UpdateNoteOptions } from "./types.ts";
import type { ListEntry } from "./notes.ts";

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

// --- Logs ---

export async function createLog(path: string, title?: string): Promise<void> {
  await request("/logs", {
    method: "POST",
    body: JSON.stringify({ path, title }),
  });
}

export async function addEntry(path: string, content: string): Promise<LogEntry> {
  return request<LogEntry>("/logs/entries", {
    method: "POST",
    body: JSON.stringify({ path, content }),
  });
}

export async function listEntries(path: string, opts?: { limit?: number }): Promise<LogEntry[]> {
  return request<LogEntry[]>(
    `/logs/entries?path=${encodeURIComponent(path)}${opts?.limit ? `&limit=${opts.limit}` : ""}`
  );
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
  opts?: { limit?: number; mode?: string }
): Promise<SearchResult[]> {
  return request<SearchResult[]>(
    `/search?q=${encodeURIComponent(query)}${opts?.limit ? `&limit=${opts.limit}` : ""}${opts?.mode ? `&mode=${opts.mode}` : ""}`
  );
}

export async function updateIndex(opts?: { force?: boolean }): Promise<void> {
  await request("/search/index", {
    method: "POST",
    body: JSON.stringify({ force: opts?.force }),
  });
}

export async function embed(opts?: { force?: boolean }): Promise<{ started: boolean; reason?: string }> {
  return request("/search/embed", {
    method: "POST",
    body: JSON.stringify({ force: opts?.force }),
  });
}

export async function notifyEmbedModelChanged(): Promise<{ reembedTriggered: boolean }> {
  return request("/search/embed/model-changed", { method: "POST" });
}

// --- Import ---

export async function importDocument(filePath: string, opts?: { to?: string }): Promise<NoteResult> {
  return request<NoteResult>("/notes/import", {
    method: "POST",
    body: JSON.stringify({ filePath, to: opts?.to }),
  });
}
