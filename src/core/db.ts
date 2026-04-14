import { join } from "path";
import { homedir } from "os";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

type DatabaseInstance = InstanceType<typeof Database>;

let db: DatabaseInstance | null = null;

type Migration = (db: DatabaseInstance) => void;

const migrations: Migration[] = [
  // Migration 1: initial schema
  (db) => {
    db.exec(`
      CREATE TABLE config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE server_heartbeat (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        pid INTEGER NOT NULL,
        port INTEGER NOT NULL,
        hostname TEXT NOT NULL DEFAULT '127.0.0.1',
        started_at TEXT NOT NULL,
        last_heartbeat TEXT NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER,
        error TEXT
      )
    `);
    db.exec(`CREATE INDEX idx_jobs_type_status ON jobs(type, status)`);
  },
  // Migration 2: add metadata column to jobs
  (db) => {
    db.exec(`ALTER TABLE jobs ADD COLUMN metadata TEXT`);
  },
];

function runMigrations(db: DatabaseInstance): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    )
  `);

  const row = db.prepare("SELECT version FROM schema_version").get() as
    | { version: number }
    | undefined;
  let currentVersion = row?.version ?? 0;

  if (currentVersion === 0 && !row) {
    db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  }

  for (let i = currentVersion; i < migrations.length; i++) {
    migrations[i]!(db);
    db.prepare("UPDATE schema_version SET version = ?").run(i + 1);
  }
}

function resolveHome(): string {
  return process.env["KNOTES_HOME"] || join(homedir(), ".knotes");
}

export function getDb(): DatabaseInstance {
  if (db) return db;

  const home = resolveHome();
  const dataDir = join(home, ".data");

  mkdirSync(dataDir, { recursive: true });

  const dbPath = join(dataDir, "knotes.sqlite");
  db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");

  runMigrations(db);

  return db;
}

export function resetDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// --- Config operations ---

export function getConfigValue(key: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setConfigValue(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?"
  ).run(key, value, value);
}

export function deleteConfigValue(key: string): void {
  const db = getDb();
  db.prepare("DELETE FROM config WHERE key = ?").run(key);
}

// --- Server heartbeat operations ---

export interface ServerInfo {
  pid: number;
  port: number;
  hostname: string;
  started_at: string;
  last_heartbeat: string;
}

export function getServerInfo(): ServerInfo | null {
  const db = getDb();
  return (db.prepare("SELECT * FROM server_heartbeat WHERE id = 1").get() as
    | ServerInfo
    | undefined) ?? null;
}

export function writeServerHeartbeat(pid: number, port: number, hostname: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO server_heartbeat (id, pid, port, hostname, started_at, last_heartbeat)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET pid = ?, port = ?, hostname = ?, last_heartbeat = ?`
  ).run(pid, port, hostname, now, now, pid, port, hostname, now);
}

export function updateHeartbeat(): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE server_heartbeat SET last_heartbeat = ? WHERE id = 1").run(now);
}

export function clearServerInfo(): void {
  const db = getDb();
  db.prepare("DELETE FROM server_heartbeat WHERE id = 1").run();
}

/**
 * Check if a server is currently alive.
 * A server is alive if its heartbeat is fresh (< 60s) and its PID is running.
 */
export function isServerAlive(): boolean {
  const info = getServerInfo();
  if (!info) return false;

  // Check heartbeat freshness (60s = 2 missed heartbeats)
  const age = Date.now() - new Date(info.last_heartbeat).getTime();
  if (age > 60_000) {
    // Stale heartbeat — clean up
    clearServerInfo();
    return false;
  }

  // Check PID is still running
  try {
    process.kill(info.pid, 0); // signal 0 = check existence
    return true;
  } catch {
    // Process is dead — clean up
    clearServerInfo();
    return false;
  }
}

// --- Job operations ---

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

export function recordJobStart(type: string): number {
  const db = getDb();
  const result = db.prepare(
    "INSERT INTO jobs (type, status, started_at) VALUES (?, 'running', ?)"
  ).run(type, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export function recordJobComplete(id: number, durationMs: number, metadata?: Record<string, unknown>): void {
  const db = getDb();
  db.prepare(
    "UPDATE jobs SET status = 'completed', completed_at = ?, duration_ms = ?, metadata = ? WHERE id = ?"
  ).run(new Date().toISOString(), durationMs, metadata ? JSON.stringify(metadata) : null, id);
}

export function recordJobFailed(id: number, error: string, durationMs: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE jobs SET status = 'failed', completed_at = ?, duration_ms = ?, error = ? WHERE id = ?"
  ).run(new Date().toISOString(), durationMs, error, id);
}

export function getLastJob(type: string): JobRecord | null {
  const db = getDb();
  return (db.prepare(
    "SELECT * FROM jobs WHERE type = ? ORDER BY id DESC LIMIT 1"
  ).get(type) as JobRecord | undefined) ?? null;
}

export function getRecentJobs(type: string, limit = 10): JobRecord[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM jobs WHERE type = ? ORDER BY id DESC LIMIT ?"
  ).all(type, limit) as JobRecord[];
}

export interface PaginatedJobs {
  jobs: JobRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export function getJobs(options?: { page?: number; pageSize?: number; type?: string }): PaginatedJobs {
  const db = getDb();
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  if (options?.type) {
    const total = (db.prepare("SELECT COUNT(*) as count FROM jobs WHERE type LIKE ?").get(`${options.type}%`) as { count: number }).count;
    const jobs = db.prepare(
      "SELECT * FROM jobs WHERE type LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?"
    ).all(`${options.type}%`, pageSize, offset) as JobRecord[];
    return { jobs, total, page, pageSize };
  }

  const total = (db.prepare("SELECT COUNT(*) as count FROM jobs").get() as { count: number }).count;
  const jobs = db.prepare(
    "SELECT * FROM jobs ORDER BY id DESC LIMIT ? OFFSET ?"
  ).all(pageSize, offset) as JobRecord[];
  return { jobs, total, page, pageSize };
}
