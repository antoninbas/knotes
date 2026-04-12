import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { Hono } from "hono";

let testHome: string;
let app: Hono;

async function json(res: Response) {
  return res.json();
}

function api(path: string, init?: RequestInit) {
  return app.request(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

function post(path: string, body: object) {
  return api(path, { method: "POST", body: JSON.stringify(body) });
}

function put(path: string, body: object) {
  return api(path, { method: "PUT", body: JSON.stringify(body) });
}

function del(path: string) {
  return api(path, { method: "DELETE" });
}

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "knotes-api-test-"));
  process.env["KNOTES_HOME"] = testHome;
  const { resetConfigCache, ensureHome } = await import("../src/core/config.ts");
  resetConfigCache();
  const { resetStore } = await import("../src/core/search.ts");
  resetStore();
  await ensureHome();
  const { createApp } = await import("../src/web/server.ts");
  app = createApp();
});

afterEach(async () => {
  await rm(testHome, { recursive: true, force: true });
  delete process.env["KNOTES_HOME"];
});

// ─── Health ──────────────────────────────────────────────────────

test("GET /api/health returns ok", async () => {
  const res = await api("/api/health");
  expect(res.status).toBe(200);
  expect(await json(res)).toEqual({ ok: true });
});

// ─── Notes API ───────────────────────────────────────────────────

test("GET /api/notes returns empty list initially", async () => {
  const res = await api("/api/notes?prefix=notes");
  expect(res.status).toBe(200);
  expect(await json(res)).toEqual([]);
});

test("POST /api/notes creates a note", async () => {
  const res = await post("/api/notes", {
    path: "notes/test",
    title: "Test Note",
    content: "Hello world",
    tags: ["demo"],
  });
  expect(res.status).toBe(201);
  const body = await json(res);
  expect(body.path).toBe("notes/test");
  expect(body.title).toBe("Test Note");
  expect(body.content).toBe("Hello world");
  expect(body.tags).toEqual(["demo"]);
  expect(body.type).toBe("note");
});

test("POST /api/notes returns 400 for missing path", async () => {
  const res = await post("/api/notes", { title: "No Path" });
  expect(res.status).toBe(400);
});

test("POST /api/notes returns 400 for duplicate", async () => {
  await post("/api/notes", { path: "notes/dup" });
  const res = await post("/api/notes", { path: "notes/dup" });
  expect(res.status).toBe(400);
  const body = await json(res);
  expect(body.error).toContain("already exists");
});

test("GET /api/notes/get returns a note", async () => {
  await post("/api/notes", { path: "notes/get-me", title: "Get Me", content: "content here" });
  const res = await api("/api/notes/get?path=notes/get-me");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.title).toBe("Get Me");
  expect(body.content).toBe("content here");
});

test("GET /api/notes/get returns 404 for missing note", async () => {
  const res = await api("/api/notes/get?path=notes/nonexistent");
  expect(res.status).toBe(404);
});

test("PUT /api/notes updates a note", async () => {
  await post("/api/notes", { path: "notes/update-me", title: "Old", content: "old content" });
  const res = await put("/api/notes", { path: "notes/update-me", title: "New", content: "new content" });
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.title).toBe("New");
  expect(body.content).toBe("new content");
});

test("PUT /api/notes returns 404 for missing note", async () => {
  const res = await put("/api/notes", { path: "notes/nope", title: "X" });
  expect(res.status).toBe(404);
});

test("DELETE /api/notes deletes a note", async () => {
  await post("/api/notes", { path: "notes/del-me" });
  const res = await del("/api/notes?path=notes/del-me");
  expect(res.status).toBe(200);
  expect(await json(res)).toEqual({ ok: true });

  // Verify it's gone
  const getRes = await api("/api/notes/get?path=notes/del-me");
  expect(getRes.status).toBe(404);
});

test("DELETE /api/notes returns 404 for missing note", async () => {
  const res = await del("/api/notes?path=notes/nope");
  expect(res.status).toBe(404);
});

test("GET /api/notes lists notes and directories", async () => {
  await post("/api/notes", { path: "notes/a", title: "Note A" });
  await post("/api/notes", { path: "notes/b", title: "Note B" });
  await post("/api/notes/folder", { path: "notes/sub" });

  const res = await api("/api/notes?prefix=notes");
  expect(res.status).toBe(200);
  const entries = await json(res);
  expect(entries.length).toBe(3);
  // Directories come first
  expect(entries[0].type).toBe("directory");
  expect(entries[0].path).toBe("notes/sub");
});

test("POST /api/notes/folder creates a folder", async () => {
  const res = await post("/api/notes/folder", { path: "notes/projects" });
  expect(res.status).toBe(201);
  const body = await json(res);
  expect(body.ok).toBe(true);
  expect(body.path).toBe("notes/projects");
});

test("POST /api/notes/folder returns 400 for duplicate", async () => {
  await post("/api/notes/folder", { path: "notes/dup-dir" });
  const res = await post("/api/notes/folder", { path: "notes/dup-dir" });
  expect(res.status).toBe(400);
});

test("GET /api/notes/download returns raw markdown", async () => {
  await post("/api/notes", { path: "notes/dl", title: "Download Me", content: "markdown content" });
  const res = await api("/api/notes/download?path=notes/dl");
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("text/markdown");
  expect(res.headers.get("Content-Disposition")).toContain("dl.md");
  const text = await res.text();
  expect(text).toContain("markdown content");
  expect(text).toContain("Download Me");
});

test("GET /api/notes/download returns 404 for missing note", async () => {
  const res = await api("/api/notes/download?path=notes/nope");
  expect(res.status).toBe(404);
});

// ─── Logs API ────────────────────────────────────────────────────

test("POST /api/logs creates a log", async () => {
  const res = await post("/api/logs", { path: "logs/daily", title: "Daily" });
  expect(res.status).toBe(201);
  const body = await json(res);
  expect(body.ok).toBe(true);
  expect(body.path).toBe("logs/daily");
});

test("POST /api/logs returns 400 for duplicate", async () => {
  await post("/api/logs", { path: "logs/dup" });
  const res = await post("/api/logs", { path: "logs/dup" });
  expect(res.status).toBe(400);
});

test("GET /api/logs/entries returns empty list for new log", async () => {
  await post("/api/logs", { path: "logs/empty" });
  const res = await api("/api/logs/entries?path=logs/empty");
  expect(res.status).toBe(200);
  expect(await json(res)).toEqual([]);
});

test("POST /api/logs/entries adds an entry", async () => {
  await post("/api/logs", { path: "logs/add" });
  const res = await post("/api/logs/entries", { path: "logs/add", content: "First entry" });
  expect(res.status).toBe(201);
  const entry = await json(res);
  expect(entry.id).toMatch(/^e-[a-f0-9]{4}$/);
  expect(entry.content).toBe("First entry");
  expect(entry.timestamp).toBeTruthy();
});

test("POST /api/logs/entries returns 400 for missing content", async () => {
  await post("/api/logs", { path: "logs/no-content" });
  const res = await post("/api/logs/entries", { path: "logs/no-content" });
  expect(res.status).toBe(400);
});

test("GET /api/logs/entries lists entries newest first", async () => {
  await post("/api/logs", { path: "logs/order" });
  await post("/api/logs/entries", { path: "logs/order", content: "First" });
  await post("/api/logs/entries", { path: "logs/order", content: "Second" });
  await post("/api/logs/entries", { path: "logs/order", content: "Third" });

  const res = await api("/api/logs/entries?path=logs/order");
  const entries = await json(res);
  expect(entries.length).toBe(3);
  expect(entries[0].content).toBe("Third");
  expect(entries[2].content).toBe("First");
});

test("GET /api/logs/entries respects limit", async () => {
  await post("/api/logs", { path: "logs/lim" });
  await post("/api/logs/entries", { path: "logs/lim", content: "One" });
  await post("/api/logs/entries", { path: "logs/lim", content: "Two" });
  await post("/api/logs/entries", { path: "logs/lim", content: "Three" });

  const res = await api("/api/logs/entries?path=logs/lim&limit=2");
  const entries = await json(res);
  expect(entries.length).toBe(2);
});

test("PUT /api/logs/entries updates an entry", async () => {
  await post("/api/logs", { path: "logs/upd" });
  const addRes = await post("/api/logs/entries", { path: "logs/upd", content: "Original" });
  const { id } = await json(addRes);

  const res = await put("/api/logs/entries", { path: "logs/upd", entryId: id, content: "Updated" });
  expect(res.status).toBe(200);
  const entry = await json(res);
  expect(entry.content).toBe("Updated");
});

test("PUT /api/logs/entries returns 404 for missing entry", async () => {
  await post("/api/logs", { path: "logs/upd-miss" });
  const res = await put("/api/logs/entries", { path: "logs/upd-miss", entryId: "e-0000", content: "X" });
  expect(res.status).toBe(404);
});

test("DELETE /api/logs/entries deletes an entry", async () => {
  await post("/api/logs", { path: "logs/del" });
  const addRes = await post("/api/logs/entries", { path: "logs/del", content: "Remove me" });
  const { id } = await json(addRes);

  const res = await del(`/api/logs/entries?path=logs/del&entryId=${id}`);
  expect(res.status).toBe(200);

  // Verify it's gone
  const listRes = await api("/api/logs/entries?path=logs/del");
  const entries = await json(listRes);
  expect(entries.length).toBe(0);
});

test("DELETE /api/logs/entries returns 404 for missing entry", async () => {
  await post("/api/logs", { path: "logs/del-miss" });
  const res = await del("/api/logs/entries?path=logs/del-miss&entryId=e-0000");
  expect(res.status).toBe(404);
});

// ─── Search API ──────────────────────────────────────────────────

test("GET /api/search returns 400 without query", async () => {
  const res = await api("/api/search");
  expect(res.status).toBe(400);
});

test("POST /api/search/index triggers indexing", async () => {
  const res = await post("/api/search/index", {});
  expect(res.status).toBe(200);
  expect(await json(res)).toEqual({ ok: true });
}, 30_000);

test("GET /api/search/embed/status returns status", async () => {
  const res = await api("/api/search/embed/status");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect("lastJob" in body).toBe(true);
});

test("search finds created notes after indexing", async () => {
  await post("/api/notes", { path: "notes/searchable", title: "Unique Searchable Title", content: "This is very specific content for search testing" });
  // Force a full index rebuild to ensure the note is picked up
  await post("/api/search/index", { force: true });

  const res = await api("/api/search?q=searchable&mode=bm25");
  expect(res.status).toBe(200);
  const results = await json(res);
  expect(results.length).toBeGreaterThan(0);
  // Verify the result references the created note (check path or title)
  const match = results.find((r: any) => r.title?.includes("Searchable") || r.path?.includes("searchable"));
  expect(match).toBeTruthy();
}, 30_000);

// ─── Jobs API ───────────────────────────────────────────────────

test("GET /api/jobs returns empty list initially", async () => {
  const res = await api("/api/jobs");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.jobs).toEqual([]);
  expect(body.total).toBe(0);
  expect(body.page).toBe(1);
  expect(body.pageSize).toBe(20);
});

test("GET /api/jobs returns jobs after indexing", async () => {
  await post("/api/search/index", {});
  const res = await api("/api/jobs");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.jobs.length).toBeGreaterThan(0);
  const indexJob = body.jobs.find((j: any) => j.type.startsWith("index:"));
  expect(indexJob).toBeTruthy();
  expect(indexJob.status).toBe("completed");
  expect(indexJob.duration_ms).toBeGreaterThanOrEqual(0);
}, 30_000);

test("GET /api/jobs supports pagination", async () => {
  // Trigger a few jobs
  await post("/api/search/index", {});
  await post("/api/search/index", {});
  await post("/api/search/index", {});

  const res = await api("/api/jobs?page=1&pageSize=2");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.jobs.length).toBe(2);
  expect(body.page).toBe(1);
  expect(body.pageSize).toBe(2);
  expect(body.total).toBeGreaterThanOrEqual(3);

  // Page 2
  const res2 = await api("/api/jobs?page=2&pageSize=2");
  const body2 = await json(res2);
  expect(body2.jobs.length).toBeGreaterThanOrEqual(1);
  expect(body2.page).toBe(2);
}, 30_000);

test("GET /api/jobs supports type filter", async () => {
  await post("/api/search/index", {});

  const res = await api("/api/jobs?type=index");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.jobs.length).toBeGreaterThan(0);
  expect(body.jobs.every((j: any) => j.type.startsWith("index"))).toBe(true);

  // Filter for a type that doesn't exist
  const res2 = await api("/api/jobs?type=nonexistent");
  const body2 = await json(res2);
  expect(body2.jobs).toEqual([]);
  expect(body2.total).toBe(0);
}, 30_000);
