import { getDb } from "../db.ts";
import type {
  GhAccount,
  GhAuthMethod,
  GhBodyMode,
  GhConnection,
  GhMonitor,
  GhSyncedEvent,
} from "./types.ts";

interface AccountRow {
  id: number;
  host: string;
  login: string;
  user_node_id: string;
  auth_method: string;
  token_scopes: string | null;
  client_id: string | null;
  created_at: string;
  last_used_at: string | null;
}

interface ConnectionRow {
  id: number;
  log_path: string;
  account_id: number;
  monitors: string;
  include_orgs: string | null;
  exclude_orgs: string | null;
  include_repos: string | null;
  exclude_repos: string | null;
  since: string;
  last_synced_at: string | null;
  enabled: number;
  body_mode: string;
  body_max_chars: number | null;
  created_at: string;
}

interface SyncedEventRow {
  connection_id: number;
  event_id: string;
  entry_id: string;
  timestamp: string;
  state_hash: string;
  url: string | null;
  created_at: string;
  updated_at: string;
}

function rowToAccount(row: AccountRow): GhAccount {
  return {
    id: row.id,
    host: row.host,
    login: row.login,
    userNodeId: row.user_node_id,
    authMethod: row.auth_method as GhAuthMethod,
    tokenScopes: row.token_scopes,
    clientId: row.client_id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function parseJsonArray(value: string | null): string[] | null {
  if (!value) return null;
  return JSON.parse(value) as string[];
}

function rowToConnection(row: ConnectionRow): GhConnection {
  return {
    id: row.id,
    logPath: row.log_path,
    accountId: row.account_id,
    monitors: JSON.parse(row.monitors) as GhMonitor[],
    includeOrgs: parseJsonArray(row.include_orgs),
    excludeOrgs: parseJsonArray(row.exclude_orgs),
    includeRepos: parseJsonArray(row.include_repos),
    excludeRepos: parseJsonArray(row.exclude_repos),
    since: row.since,
    lastSyncedAt: row.last_synced_at,
    enabled: row.enabled === 1,
    bodyMode: (row.body_mode || "title") as GhBodyMode,
    bodyMaxChars: row.body_max_chars,
    createdAt: row.created_at,
  };
}

function rowToSyncedEvent(row: SyncedEventRow): GhSyncedEvent {
  return {
    connectionId: row.connection_id,
    eventId: row.event_id,
    entryId: row.entry_id,
    timestamp: row.timestamp,
    stateHash: row.state_hash,
    url: row.url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Accounts ---

export interface InsertAccountInput {
  host: string;
  login: string;
  userNodeId: string;
  authMethod: GhAuthMethod;
  tokenScopes?: string | null;
  clientId?: string | null;
}

export function insertAccount(input: InsertAccountInput): number {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO github_accounts
         (host, login, user_node_id, auth_method, token_scopes, client_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(host, login) DO UPDATE SET
         user_node_id = excluded.user_node_id,
         auth_method = excluded.auth_method,
         token_scopes = excluded.token_scopes,
         client_id = excluded.client_id`
    )
    .run(
      input.host,
      input.login,
      input.userNodeId,
      input.authMethod,
      input.tokenScopes ?? null,
      input.clientId ?? null,
      now
    );
  if (result.lastInsertRowid) return Number(result.lastInsertRowid);
  const row = db
    .prepare("SELECT id FROM github_accounts WHERE host = ? AND login = ?")
    .get(input.host, input.login) as { id: number };
  return row.id;
}

export function getAccount(host: string, login: string): GhAccount | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM github_accounts WHERE host = ? AND login = ?")
    .get(host, login) as AccountRow | undefined;
  return row ? rowToAccount(row) : null;
}

export function getAccountById(id: number): GhAccount | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM github_accounts WHERE id = ?")
    .get(id) as AccountRow | undefined;
  return row ? rowToAccount(row) : null;
}

export function listAccounts(): GhAccount[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM github_accounts ORDER BY host, login")
    .all() as AccountRow[];
  return rows.map(rowToAccount);
}

export function deleteAccount(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM github_accounts WHERE id = ?").run(id);
}

export function touchAccount(id: number): void {
  const db = getDb();
  db.prepare("UPDATE github_accounts SET last_used_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    id
  );
}

// --- Connections ---

export interface InsertConnectionInput {
  logPath: string;
  accountId: number;
  monitors: GhMonitor[];
  includeOrgs?: string[] | null;
  excludeOrgs?: string[] | null;
  includeRepos?: string[] | null;
  excludeRepos?: string[] | null;
  /** Used on insert. Also overwrites on conflict when overwriteSince=true. */
  since: string;
  /**
   * If true (default false), an ON CONFLICT update overwrites the stored
   * `since` with the new value. Defaults to false so a user re-running
   * `connect` without `--since` doesn't silently reset their backfill cutoff.
   */
  overwriteSince?: boolean;
  enabled?: boolean;
  bodyMode?: GhBodyMode;
  bodyMaxChars?: number | null;
}

export function insertConnection(input: InsertConnectionInput): number {
  const db = getDb();
  const now = new Date().toISOString();
  const sinceClause = input.overwriteSince ? "since = excluded.since," : "";
  const result = db
    .prepare(
      `INSERT INTO github_connections
         (log_path, account_id, monitors, include_orgs, exclude_orgs, include_repos, exclude_repos, since, enabled, body_mode, body_max_chars, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(log_path, account_id) DO UPDATE SET
         monitors = excluded.monitors,
         include_orgs = excluded.include_orgs,
         exclude_orgs = excluded.exclude_orgs,
         include_repos = excluded.include_repos,
         exclude_repos = excluded.exclude_repos,
         ${sinceClause}
         enabled = excluded.enabled,
         body_mode = excluded.body_mode,
         body_max_chars = excluded.body_max_chars`
    )
    .run(
      input.logPath,
      input.accountId,
      JSON.stringify(input.monitors),
      input.includeOrgs ? JSON.stringify(input.includeOrgs) : null,
      input.excludeOrgs ? JSON.stringify(input.excludeOrgs) : null,
      input.includeRepos ? JSON.stringify(input.includeRepos) : null,
      input.excludeRepos ? JSON.stringify(input.excludeRepos) : null,
      input.since,
      input.enabled === false ? 0 : 1,
      input.bodyMode ?? "title",
      input.bodyMaxChars ?? null,
      now
    );
  if (result.lastInsertRowid) return Number(result.lastInsertRowid);
  const row = db
    .prepare(
      "SELECT id FROM github_connections WHERE log_path = ? AND account_id = ?"
    )
    .get(input.logPath, input.accountId) as { id: number };
  return row.id;
}

export function getConnection(id: number): GhConnection | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM github_connections WHERE id = ?")
    .get(id) as ConnectionRow | undefined;
  return row ? rowToConnection(row) : null;
}

export function listConnections(opts?: {
  logPath?: string;
  accountId?: number;
}): GhConnection[] {
  const db = getDb();
  if (opts?.logPath !== undefined) {
    const rows = db
      .prepare(
        "SELECT * FROM github_connections WHERE log_path = ? ORDER BY id"
      )
      .all(opts.logPath) as ConnectionRow[];
    return rows.map(rowToConnection);
  }
  if (opts?.accountId !== undefined) {
    const rows = db
      .prepare(
        "SELECT * FROM github_connections WHERE account_id = ? ORDER BY id"
      )
      .all(opts.accountId) as ConnectionRow[];
    return rows.map(rowToConnection);
  }
  const rows = db
    .prepare("SELECT * FROM github_connections ORDER BY id")
    .all() as ConnectionRow[];
  return rows.map(rowToConnection);
}

export interface UpdateConnectionPatch {
  monitors?: GhMonitor[];
  includeOrgs?: string[] | null;
  excludeOrgs?: string[] | null;
  includeRepos?: string[] | null;
  excludeRepos?: string[] | null;
  since?: string;
  enabled?: boolean;
  bodyMode?: GhBodyMode;
  bodyMaxChars?: number | null;
  lastSyncedAt?: string;
}

export function updateConnection(
  id: number,
  patch: UpdateConnectionPatch
): void {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.monitors !== undefined) {
    sets.push("monitors = ?");
    values.push(JSON.stringify(patch.monitors));
  }
  if (patch.includeOrgs !== undefined) {
    sets.push("include_orgs = ?");
    values.push(patch.includeOrgs ? JSON.stringify(patch.includeOrgs) : null);
  }
  if (patch.excludeOrgs !== undefined) {
    sets.push("exclude_orgs = ?");
    values.push(patch.excludeOrgs ? JSON.stringify(patch.excludeOrgs) : null);
  }
  if (patch.includeRepos !== undefined) {
    sets.push("include_repos = ?");
    values.push(patch.includeRepos ? JSON.stringify(patch.includeRepos) : null);
  }
  if (patch.excludeRepos !== undefined) {
    sets.push("exclude_repos = ?");
    values.push(patch.excludeRepos ? JSON.stringify(patch.excludeRepos) : null);
  }
  if (patch.since !== undefined) {
    sets.push("since = ?");
    values.push(patch.since);
  }
  if (patch.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(patch.enabled ? 1 : 0);
  }
  if (patch.bodyMode !== undefined) {
    sets.push("body_mode = ?");
    values.push(patch.bodyMode);
  }
  if (patch.bodyMaxChars !== undefined) {
    sets.push("body_max_chars = ?");
    values.push(patch.bodyMaxChars);
  }
  if (patch.lastSyncedAt !== undefined) {
    sets.push("last_synced_at = ?");
    values.push(patch.lastSyncedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(
    `UPDATE github_connections SET ${sets.join(", ")} WHERE id = ?`
  ).run(...values);
}

export function deleteConnection(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM github_connections WHERE id = ?").run(id);
}

// --- Synced events ---

export function getSyncedEvent(
  connectionId: number,
  eventId: string
): GhSyncedEvent | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM github_synced_events WHERE connection_id = ? AND event_id = ?"
    )
    .get(connectionId, eventId) as SyncedEventRow | undefined;
  return row ? rowToSyncedEvent(row) : null;
}

export interface UpsertSyncedEventInput {
  connectionId: number;
  eventId: string;
  entryId: string;
  timestamp: string;
  stateHash: string;
  url?: string | null;
}

export function upsertSyncedEvent(input: UpsertSyncedEventInput): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO github_synced_events
       (connection_id, event_id, entry_id, timestamp, state_hash, url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(connection_id, event_id) DO UPDATE SET
       entry_id = excluded.entry_id,
       timestamp = excluded.timestamp,
       state_hash = excluded.state_hash,
       url = excluded.url,
       updated_at = excluded.updated_at`
  ).run(
    input.connectionId,
    input.eventId,
    input.entryId,
    input.timestamp,
    input.stateHash,
    input.url ?? null,
    now,
    now
  );
}

export function listSyncedEvents(connectionId: number): GhSyncedEvent[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM github_synced_events WHERE connection_id = ? ORDER BY timestamp DESC"
    )
    .all(connectionId) as SyncedEventRow[];
  return rows.map(rowToSyncedEvent);
}
