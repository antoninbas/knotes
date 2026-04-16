import type { ListEntry, NoteResult, LogEntry, SearchResult } from "../../../core/types.ts";
export type { ListEntry, NoteResult, LogEntry, SearchResult };

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
  create: (path: string, title?: string, description?: string) =>
    request<{ ok: boolean; path: string }>("/logs", {
      method: "POST",
      body: JSON.stringify({ path, title, description }),
    }),

  updateJournal: (path: string, opts: { title?: string; description?: string | null }) =>
    request<{ ok: boolean }>("/logs", {
      method: "PUT",
      body: JSON.stringify({ path, ...opts }),
    }),

  deleteJournal: (path: string) =>
    request<{ ok: boolean }>(`/logs?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
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

// Jobs API
export interface JobRecord {
  id: number;
  type: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  metadata: string | null;
}

export interface PaginatedJobs {
  jobs: JobRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export const jobsApi = {
  list: (opts?: { page?: number; pageSize?: number; type?: string }) =>
    request<PaginatedJobs>(
      `/jobs?page=${opts?.page ?? 1}&pageSize=${opts?.pageSize ?? 20}${opts?.type ? `&type=${encodeURIComponent(opts.type)}` : ""}`
    ),
};

// Version API
export const versionApi = {
  get: async (): Promise<string> => {
    const res = await fetch(`${BASE}/version`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
};

// Context API
export const contextApi = {
  list: () =>
    request<{ path: string; context: string }[]>("/context"),

  get: (path: string) =>
    request<{ context: string | null }>(`/context/get?path=${encodeURIComponent(path)}`),

  set: (path: string, context: string) =>
    request<{ ok: boolean }>("/context", {
      method: "PUT",
      body: JSON.stringify({ path, context }),
    }),

  remove: (path: string) =>
    request<{ ok: boolean }>(`/context?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }),
};
