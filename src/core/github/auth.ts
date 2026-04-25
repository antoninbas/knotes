import { spawnSync } from "node:child_process";
import {
  insertAccount,
  getAccount,
  getAccountById,
  readToken,
  touchAccount,
  deleteAccount,
} from "./db.ts";
import { createClient, normalizeHost } from "./api.ts";
import type { GhAccount } from "./types.ts";

/**
 * Public OAuth-App client_id for the knotes Device Flow. Intentionally
 * shipped in source — Device Flow does not use a client secret. Used in
 * milestone 6 (loginDevice).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const KNOTES_GITHUB_CLIENT_ID = "Iv1.PLACEHOLDER";

export async function loginPat(
  hostInput: string,
  token: string
): Promise<GhAccount> {
  const host = normalizeHost(hostInput);
  const client = createClient({
    authHeader: `token ${token}`,
    host,
  });
  const viewer = await client.resolveViewer();
  insertAccount({
    host,
    login: viewer.login,
    userNodeId: viewer.nodeId,
    authMethod: "pat",
    token,
    tokenScopes: viewer.scopes,
  });
  const acct = getAccount(host, viewer.login);
  if (!acct) throw new Error("Failed to insert account");
  return acct;
}

export async function loginGhCli(hostInput: string): Promise<GhAccount> {
  const host = normalizeHost(hostInput);
  const token = ghAuthToken(host);
  if (!token) {
    throw new Error(
      `gh CLI is not authenticated for ${host}. Run: gh auth login --hostname ${host}`
    );
  }
  const client = createClient({
    authHeader: `token ${token}`,
    host,
  });
  const viewer = await client.resolveViewer();
  insertAccount({
    host,
    login: viewer.login,
    userNodeId: viewer.nodeId,
    authMethod: "gh-cli",
    token: null,
    tokenScopes: viewer.scopes,
  });
  const acct = getAccount(host, viewer.login);
  if (!acct) throw new Error("Failed to insert account");
  return acct;
}

function ghAuthToken(host: string): string | null {
  const result = spawnSync("gh", ["auth", "token", "--hostname", host], {
    encoding: "utf-8",
  });
  if (result.status !== 0) return null;
  const token = result.stdout.trim();
  return token || null;
}

export async function getAuthHeader(accountId: number): Promise<string> {
  const acct = getAccountById(accountId);
  if (!acct) throw new Error(`Account ${accountId} not found`);

  let token: string | null;
  if (acct.authMethod === "gh-cli") {
    token = ghAuthToken(acct.host);
    if (!token) {
      throw new Error(
        `gh CLI authentication for ${acct.host} is not available. Run: gh auth login --hostname ${acct.host}`
      );
    }
  } else {
    token = readToken(accountId);
    if (!token) {
      throw new Error(
        `No token stored for ${acct.host}:${acct.login}. Run: knotes github auth login`
      );
    }
  }

  touchAccount(accountId);
  return `token ${token}`;
}

export async function logout(hostInput: string, login: string): Promise<void> {
  const host = normalizeHost(hostInput);
  const acct = getAccount(host, login);
  if (!acct) throw new Error(`Account not found: ${host}:${login}`);
  deleteAccount(acct.id);
}
