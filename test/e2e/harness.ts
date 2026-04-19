import { mkdtemp, rm, cp } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import type { ChildProcess } from "node:child_process";
import type { SearchMode, SearchResult, NoteResult, ListEntry, LogEntry } from "../../src/core/types.ts";
import { PINNED_CONFIG } from "./fixtures/pinned-config.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(__dirname, "corpus");
const PROJECT_ROOT = join(__dirname, "../..");

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as { port: number };
      srv.close(() => resolve(addr.port));
    });
    srv.on("error", reject);
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  const body = await resp.json() as any;
  if (!resp.ok) throw new Error(body?.error ?? `HTTP ${resp.status}`);
  return body as T;
}

export class Harness {
  mode!: "serverless" | "server";
  home!: string;
  private baseUrl: string | null = null;
  private serverProcess: ChildProcess | null = null;

  async start(mode: "serverless" | "server"): Promise<void> {
    this.mode = mode;
    this.home = await mkdtemp(join(tmpdir(), `knotes-e2e-${mode}-`));

    process.env["KNOTES_HOME"] = this.home;

    const { resetConfigCache, ensureHome, saveConfig } = await import("../../src/core/config.ts");
    const { resetDb } = await import("../../src/core/db.ts");
    const { resetStore } = await import("../../src/core/search.ts");

    resetConfigCache();
    resetDb();
    resetStore();
    await ensureHome();

    await saveConfig({
      serverless: mode === "serverless",
      rerank: PINNED_CONFIG.rerank,
      queryExpand: PINNED_CONFIG.queryExpand,
      embedInterval: PINNED_CONFIG.embedInterval,
      embedModel: PINNED_CONFIG.embedModel,
    });

    await cp(join(CORPUS_DIR, "notes"), join(this.home, "notes"), { recursive: true });
    await cp(join(CORPUS_DIR, "logs"), join(this.home, "logs"), { recursive: true });

    if (mode === "serverless") {
      const { updateIndex, embed } = await import("../../src/core/search.ts");
      await updateIndex();
      await embed({ trigger: "on-demand" });
    } else {
      // Release the DB before spawning so subprocess can open it
      resetDb();
      resetStore();
      delete process.env["KNOTES_HOME"];

      const port = await getFreePort();
      this.baseUrl = `http://127.0.0.1:${port}`;

      this.serverProcess = spawn("npx", ["tsx", "src/main.ts", "server", "--port", String(port)], {
        env: { ...process.env, KNOTES_HOME: this.home },
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.serverProcess.stdout?.on("data", () => {});
      this.serverProcess.stderr?.on("data", () => {});

      await this._waitForServer();
      await this._waitForEmbed();
    }
  }

  private async _waitForServer(): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`${this.baseUrl}/api/health`);
        if (resp.ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("E2E server did not start within 20 seconds");
  }

  private async _waitForEmbed(): Promise<void> {
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`${this.baseUrl}/api/search/embed/status`);
        const data = (await resp.json()) as { lastJob: { status: string; error?: string } | null };
        const s = data.lastJob?.status;
        if (s === "completed") return;
        if (s === "failed") throw new Error(`Embed failed: ${data.lastJob?.error ?? "unknown"}`);
      } catch (err: any) {
        if (err.message?.startsWith("Embed failed:")) throw err;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("E2E embed did not complete within 300 seconds");
  }

  async stop(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill("SIGTERM");
      // Wait for process to fully exit and release the port
      await new Promise<void>((resolve) => {
        this.serverProcess!.once("exit", () => resolve());
        setTimeout(resolve, 3000);
      });
      this.serverProcess = null;
    }

    if (this.mode === "serverless" || process.env["KNOTES_HOME"] === this.home) {
      const { resetDb } = await import("../../src/core/db.ts");
      const { resetStore } = await import("../../src/core/search.ts");
      resetDb();
      resetStore();
      delete process.env["KNOTES_HOME"];
    }

    await rm(this.home, { recursive: true, force: true });
  }

  // Ensure this harness's KNOTES_HOME is active (needed for serverless when two harnesses exist)
  private async _ensureEnv(): Promise<void> {
    if (this.mode !== "serverless") return;
    if (process.env["KNOTES_HOME"] !== this.home) {
      process.env["KNOTES_HOME"] = this.home;
      const { resetDb } = await import("../../src/core/db.ts");
      const { resetStore } = await import("../../src/core/search.ts");
      resetDb();
      resetStore();
    }
  }

  async search(
    query: string,
    opts?: {
      limit?: number;
      mode?: SearchMode;
      rerank?: boolean;
      queryExpand?: boolean;
      collections?: ("notes" | "logs")[];
      minScore?: number;
    }
  ): Promise<SearchResult[]> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { search } = await import("../../src/core/router.ts");
      return search(query, opts) as Promise<SearchResult[]>;
    }
    const url = new URL(`${this.baseUrl}/api/search`);
    url.searchParams.set("q", query);
    if (opts?.limit != null) url.searchParams.set("limit", String(opts.limit));
    if (opts?.mode) url.searchParams.set("mode", opts.mode);
    if (opts?.collections?.length) url.searchParams.set("collections", opts.collections.join(","));
    if (opts?.minScore != null) url.searchParams.set("minScore", String(opts.minScore));
    return fetchJson<SearchResult[]>(url.toString());
  }

  async getNote(path: string): Promise<NoteResult> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { getNote } = await import("../../src/core/router.ts");
      return getNote(path) as Promise<NoteResult>;
    }
    const url = new URL(`${this.baseUrl}/api/notes/get`);
    url.searchParams.set("path", path);
    return fetchJson<NoteResult>(url.toString());
  }

  async createNote(path: string, opts?: { title?: string; content?: string; tags?: string[] }): Promise<NoteResult> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { createNote } = await import("../../src/core/router.ts");
      return createNote(path, opts) as Promise<NoteResult>;
    }
    return fetchJson<NoteResult>(`${this.baseUrl}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, ...opts }),
    });
  }

  async updateNote(path: string, opts: { title?: string; content?: string; tags?: string[] }): Promise<NoteResult> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { updateNote } = await import("../../src/core/router.ts");
      return updateNote(path, opts) as Promise<NoteResult>;
    }
    return fetchJson<NoteResult>(`${this.baseUrl}/api/notes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, ...opts }),
    });
  }

  async deleteNote(path: string): Promise<void> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { deleteNote } = await import("../../src/core/router.ts");
      return deleteNote(path);
    }
    const url = new URL(`${this.baseUrl}/api/notes`);
    url.searchParams.set("path", path);
    await fetchJson<{ ok: boolean }>(url.toString(), { method: "DELETE" });
  }

  async listNotes(prefix?: string): Promise<ListEntry[]> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { listNotes } = await import("../../src/core/router.ts");
      return listNotes(prefix) as Promise<ListEntry[]>;
    }
    const url = new URL(`${this.baseUrl}/api/notes`);
    if (prefix) url.searchParams.set("prefix", prefix);
    return fetchJson<ListEntry[]>(url.toString());
  }

  async createFolder(path: string): Promise<void> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { createFolder } = await import("../../src/core/router.ts");
      return createFolder(path);
    }
    await fetchJson<{ ok: boolean }>(`${this.baseUrl}/api/notes/folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  }

  async deleteFolder(path: string): Promise<void> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { deleteFolder } = await import("../../src/core/router.ts");
      return deleteFolder(path);
    }
    const url = new URL(`${this.baseUrl}/api/notes/folder`);
    url.searchParams.set("path", path);
    await fetchJson<{ ok: boolean }>(url.toString(), { method: "DELETE" });
  }

  async listJournals(prefix?: string): Promise<ListEntry[]> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { listJournals } = await import("../../src/core/router.ts");
      return listJournals(prefix) as Promise<ListEntry[]>;
    }
    const url = new URL(`${this.baseUrl}/api/logs`);
    if (prefix) url.searchParams.set("prefix", prefix);
    return fetchJson<ListEntry[]>(url.toString());
  }

  async createLog(path: string, title?: string): Promise<void> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { createLog } = await import("../../src/core/router.ts");
      return createLog(path, title);
    }
    await fetchJson<{ ok: boolean; path: string }>(`${this.baseUrl}/api/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, title }),
    });
  }

  async deleteLog(path: string): Promise<void> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { deleteLog } = await import("../../src/core/router.ts");
      return deleteLog(path);
    }
    const url = new URL(`${this.baseUrl}/api/logs`);
    url.searchParams.set("path", path);
    await fetchJson<{ ok: boolean }>(url.toString(), { method: "DELETE" });
  }

  async addEntry(path: string, content: string): Promise<LogEntry> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { addEntry } = await import("../../src/core/router.ts");
      return addEntry(path, content) as Promise<LogEntry>;
    }
    return fetchJson<LogEntry>(`${this.baseUrl}/api/logs/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
  }

  async listEntries(path: string, opts?: { limit?: number }): Promise<LogEntry[]> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { listEntries } = await import("../../src/core/router.ts");
      return listEntries(path, opts) as Promise<LogEntry[]>;
    }
    const url = new URL(`${this.baseUrl}/api/logs/entries`);
    url.searchParams.set("path", path);
    if (opts?.limit != null) url.searchParams.set("limit", String(opts.limit));
    return fetchJson<LogEntry[]>(url.toString());
  }

  async updateEntry(path: string, entryId: string, content: string): Promise<LogEntry> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { updateEntry } = await import("../../src/core/router.ts");
      return updateEntry(path, entryId, content) as Promise<LogEntry>;
    }
    return fetchJson<LogEntry>(`${this.baseUrl}/api/logs/entries`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, entryId, content }),
    });
  }

  async deleteEntry(path: string, entryId: string): Promise<void> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { deleteEntry } = await import("../../src/core/router.ts");
      return deleteEntry(path, entryId);
    }
    const url = new URL(`${this.baseUrl}/api/logs/entries`);
    url.searchParams.set("path", path);
    url.searchParams.set("entryId", entryId);
    await fetchJson<{ ok: boolean }>(url.toString(), { method: "DELETE" });
  }

  async getContext(path: string): Promise<string | undefined> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { getContext } = await import("../../src/core/router.ts");
      return getContext(path) as Promise<string | undefined>;
    }
    const url = new URL(`${this.baseUrl}/api/context/get`);
    url.searchParams.set("path", path);
    const resp = await fetch(url.toString());
    const data = (await resp.json()) as { context: string | null };
    return data.context ?? undefined;
  }

  async setContext(path: string, context: string): Promise<void> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { setContext } = await import("../../src/core/router.ts");
      return setContext(path, context);
    }
    await fetchJson<{ ok: boolean }>(`${this.baseUrl}/api/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, context }),
    });
  }

  async listContexts(): Promise<{ path: string; context: string }[]> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { listContexts } = await import("../../src/core/router.ts");
      return listContexts() as Promise<{ path: string; context: string }[]>;
    }
    return fetchJson<{ path: string; context: string }[]>(`${this.baseUrl}/api/context`);
  }

  async removeContext(path: string): Promise<void> {
    if (this.mode === "serverless") {
      await this._ensureEnv();
      const { removeContext } = await import("../../src/core/router.ts");
      return removeContext(path);
    }
    const url = new URL(`${this.baseUrl}/api/context`);
    url.searchParams.set("path", path);
    await fetchJson<{ ok: boolean }>(url.toString(), { method: "DELETE" });
  }
}
