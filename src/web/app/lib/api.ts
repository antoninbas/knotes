const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Types matching the core layer
export interface ListEntry {
  path: string;
  title: string;
  type: "note" | "log" | "directory";
  modified?: string;
}

export interface NoteResult {
  path: string;
  filePath: string;
  title: string;
  created: string;
  modified: string;
  tags: string[];
  type: "note" | "log";
  content: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  content: string;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

// Notes API
export const notes = {
  list: (prefix?: string) =>
    request<ListEntry[]>(`/notes?${prefix ? `prefix=${encodeURIComponent(prefix)}` : ""}`),

  get: (path: string) =>
    request<NoteResult>(`/notes/get?path=${encodeURIComponent(path)}`),

  create: (path: string, opts?: { title?: string; content?: string; tags?: string[] }) =>
    request<NoteResult>("/notes", {
      method: "POST",
      body: JSON.stringify({ path, ...opts }),
    }),

  update: (path: string, opts: { title?: string; content?: string; tags?: string[] }) =>
    request<NoteResult>("/notes", {
      method: "PUT",
      body: JSON.stringify({ path, ...opts }),
    }),

  delete: (path: string) =>
    request<{ ok: boolean }>(`/notes?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }),

  createFolder: (path: string) =>
    request<{ ok: boolean; path: string }>("/notes/folder", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
};

// Logs API
export const logs = {
  create: (path: string, title?: string) =>
    request<{ ok: boolean; path: string }>("/logs", {
      method: "POST",
      body: JSON.stringify({ path, title }),
    }),

  listEntries: (path: string, limit?: number) =>
    request<LogEntry[]>(
      `/logs/entries?path=${encodeURIComponent(path)}${limit ? `&limit=${limit}` : ""}`
    ),

  addEntry: (path: string, content: string) =>
    request<LogEntry>("/logs/entries", {
      method: "POST",
      body: JSON.stringify({ path, content }),
    }),

  updateEntry: (path: string, entryId: string, content: string) =>
    request<LogEntry>("/logs/entries", {
      method: "PUT",
      body: JSON.stringify({ path, entryId, content }),
    }),

  deleteEntry: (path: string, entryId: string) =>
    request<{ ok: boolean }>(
      `/logs/entries?path=${encodeURIComponent(path)}&entryId=${encodeURIComponent(entryId)}`,
      { method: "DELETE" }
    ),
};

// Search API
export const searchApi = {
  search: (query: string, opts?: { limit?: number; mode?: string }) =>
    request<SearchResult[]>(
      `/search?q=${encodeURIComponent(query)}${opts?.limit ? `&limit=${opts.limit}` : ""}${opts?.mode ? `&mode=${opts.mode}` : ""}`
    ),

  embed: (force?: boolean) =>
    request<{ ok: boolean }>("/search/embed", {
      method: "POST",
      body: JSON.stringify({ force }),
    }),

  embedStatus: () =>
    request<{ lastJob: { status: string; completed_at: string | null; duration_ms: number | null } | null }>(
      "/search/embed/status"
    ),
};

// Version API
export interface VersionInfo {
  version: string;
  homepage: string;
  author: string;
}

export const versionApi = {
  get: () => request<VersionInfo>("/version"),
};
