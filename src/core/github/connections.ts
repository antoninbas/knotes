import { existsSync } from "node:fs";
import { resolvePath } from "../config.ts";
import {
  getAccount,
  insertConnection,
  listConnections as dbListConnections,
  getConnection,
  deleteConnection as dbDeleteConnection,
  updateConnection as dbUpdateConnection,
  listAccounts as dbListAccounts,
} from "./db.ts";
import { logout as authLogout } from "./auth.ts";
import { normalizeHost } from "./api.ts";
import type { GhAccount, GhBodyMode, GhConnection, GhMonitor } from "./types.ts";

const VALID_BODY_MODES: GhBodyMode[] = [
  "title",
  "full",
  "first_paragraph",
  "first_chars",
];

function validateBodyMode(mode: GhBodyMode, maxChars?: number | null): void {
  if (!VALID_BODY_MODES.includes(mode)) {
    throw new Error(
      `Invalid body mode: ${mode}. Valid: ${VALID_BODY_MODES.join(", ")}`
    );
  }
  if (mode === "first_chars") {
    if (typeof maxChars !== "number" || maxChars <= 0) {
      throw new Error(
        `bodyMode "first_chars" requires bodyMaxChars > 0`
      );
    }
  }
}

const VALID_MONITORS: GhMonitor[] = [
  "opened_prs",
  "merged_prs",
  "opened_issues",
  "pr_reviews",
];

function defaultSince(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

function lowercaseAll(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  return values.map((v) => v.trim().toLowerCase()).filter((v) => v.length > 0);
}

function validateMonitors(monitors: GhMonitor[]): void {
  if (!monitors || monitors.length === 0) {
    throw new Error("At least one monitor is required");
  }
  for (const m of monitors) {
    if (!VALID_MONITORS.includes(m)) {
      throw new Error(
        `Invalid monitor: ${m}. Valid: ${VALID_MONITORS.join(", ")}`
      );
    }
  }
}

function validateLogPath(logPath: string): void {
  if (!logPath.startsWith("logs/")) {
    throw new Error(`Log path must start with logs/: ${logPath}`);
  }
  const filePath = resolvePath(logPath);
  if (!existsSync(filePath)) {
    throw new Error(`Log not found: ${logPath}. Create it first with: knotes log create-journal ${logPath}`);
  }
}

export interface AddConnectionInput {
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

export async function addConnection(
  input: AddConnectionInput
): Promise<GhConnection> {
  validateLogPath(input.logPath);
  validateMonitors(input.monitors);
  const bodyMode = input.bodyMode ?? "title";
  validateBodyMode(bodyMode, input.bodyMaxChars);

  const host = normalizeHost(input.host);
  const acct = getAccount(host, input.login);
  if (!acct) {
    throw new Error(
      `Account not found: ${host}:${input.login}. Run: knotes github auth login --host ${host}`
    );
  }

  const id = insertConnection({
    logPath: input.logPath,
    accountId: acct.id,
    monitors: input.monitors,
    includeOrgs: lowercaseAll(input.includeOrgs) ?? null,
    excludeOrgs: lowercaseAll(input.excludeOrgs) ?? null,
    includeRepos: lowercaseAll(input.includeRepos) ?? null,
    excludeRepos: lowercaseAll(input.excludeRepos) ?? null,
    since: input.since || defaultSince(),
    bodyMode,
    bodyMaxChars: bodyMode === "first_chars" ? (input.bodyMaxChars ?? null) : null,
  });

  const conn = getConnection(id);
  if (!conn) throw new Error("Failed to insert connection");
  return conn;
}

export async function listConnections(
  logPath?: string
): Promise<GhConnection[]> {
  return dbListConnections(logPath !== undefined ? { logPath } : undefined);
}

export async function getConnectionById(
  id: number
): Promise<GhConnection | null> {
  return getConnection(id);
}

export async function removeConnection(id: number): Promise<void> {
  const conn = getConnection(id);
  if (!conn) throw new Error(`Connection not found: ${id}`);
  dbDeleteConnection(id);
}

export interface UpdateConnectionInput {
  monitors?: GhMonitor[];
  includeOrgs?: string[] | null;
  excludeOrgs?: string[] | null;
  includeRepos?: string[] | null;
  excludeRepos?: string[] | null;
  since?: string;
  enabled?: boolean;
  bodyMode?: GhBodyMode;
  bodyMaxChars?: number | null;
}

export async function updateConnection(
  id: number,
  patch: UpdateConnectionInput
): Promise<GhConnection> {
  const conn = getConnection(id);
  if (!conn) throw new Error(`Connection not found: ${id}`);
  if (patch.monitors !== undefined) validateMonitors(patch.monitors);
  if (patch.bodyMode !== undefined) {
    const effectiveMaxChars =
      patch.bodyMaxChars !== undefined ? patch.bodyMaxChars : conn.bodyMaxChars;
    validateBodyMode(patch.bodyMode, effectiveMaxChars);
  }

  dbUpdateConnection(id, {
    ...(patch.monitors !== undefined && { monitors: patch.monitors }),
    ...(patch.includeOrgs !== undefined && {
      includeOrgs: patch.includeOrgs ? (lowercaseAll(patch.includeOrgs) ?? null) : null,
    }),
    ...(patch.excludeOrgs !== undefined && {
      excludeOrgs: patch.excludeOrgs ? (lowercaseAll(patch.excludeOrgs) ?? null) : null,
    }),
    ...(patch.includeRepos !== undefined && {
      includeRepos: patch.includeRepos ? (lowercaseAll(patch.includeRepos) ?? null) : null,
    }),
    ...(patch.excludeRepos !== undefined && {
      excludeRepos: patch.excludeRepos ? (lowercaseAll(patch.excludeRepos) ?? null) : null,
    }),
    ...(patch.since !== undefined && { since: patch.since }),
    ...(patch.enabled !== undefined && { enabled: patch.enabled }),
    ...(patch.bodyMode !== undefined && { bodyMode: patch.bodyMode }),
    ...(patch.bodyMaxChars !== undefined && { bodyMaxChars: patch.bodyMaxChars }),
  });

  const updated = getConnection(id);
  if (!updated) throw new Error(`Connection ${id} disappeared`);
  return updated;
}

export async function listAccounts(): Promise<GhAccount[]> {
  return dbListAccounts();
}

export async function logout(host: string, login: string): Promise<void> {
  return authLogout(host, login);
}

export interface ConnectionFilter {
  includeOrgs: string[] | null;
  excludeOrgs: string[] | null;
  includeRepos: string[] | null;
  excludeRepos: string[] | null;
}

export function passesFilters(
  filter: ConnectionFilter,
  owner: string,
  repo: string
): boolean {
  const o = owner.toLowerCase();
  const orepo = `${o}/${repo.toLowerCase()}`;
  if (filter.includeOrgs && !filter.includeOrgs.includes(o)) return false;
  if (filter.excludeOrgs?.includes(o)) return false;
  if (filter.includeRepos && !filter.includeRepos.includes(orepo)) return false;
  if (filter.excludeRepos?.includes(orepo)) return false;
  return true;
}
