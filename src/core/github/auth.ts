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
 * shipped in source — Device Flow does not require a client secret.
 * Override via KNOTES_GITHUB_CLIENT_ID for self-hosted GHES instances
 * or for development against a different OAuth app.
 */
const DEFAULT_GITHUB_CLIENT_ID = "Iv1.PLACEHOLDER";

function resolveClientId(): string {
  return process.env["KNOTES_GITHUB_CLIENT_ID"] || DEFAULT_GITHUB_CLIENT_ID;
}

function deviceCodeUrl(host: string): string {
  return host === "github.com"
    ? "https://github.com/login/device/code"
    : `https://${host}/login/device/code`;
}

function accessTokenUrl(host: string): string {
  return host === "github.com"
    ? "https://github.com/login/oauth/access_token"
    : `https://${host}/login/oauth/access_token`;
}

interface DeviceCodePayload {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenPayload {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startDeviceFlow(
  hostInput: string,
  scope = "repo read:user read:org"
): Promise<DeviceCodePayload & { host: string }> {
  const host = normalizeHost(hostInput);
  const clientId = resolveClientId();
  const res = await fetch(deviceCodeUrl(host), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ client_id: clientId, scope }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Device flow not available on ${host} (${res.status}). ${body || "Use --method pat instead."}`
    );
  }
  const payload = (await res.json()) as DeviceCodePayload;
  if (!payload.device_code || !payload.user_code) {
    throw new Error(
      `Device flow returned an unexpected payload from ${host}. Use --method pat instead.`
    );
  }
  return { ...payload, host };
}

export async function pollDeviceToken(
  host: string,
  deviceCode: string,
  intervalSec: number
): Promise<{ status: "pending" | "ok"; token?: string; scope?: string }> {
  const clientId = resolveClientId();
  const res = await fetch(accessTokenUrl(host), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Device token poll failed: HTTP ${res.status}`);
  }
  const payload = (await res.json()) as AccessTokenPayload;
  if (payload.access_token) {
    return { status: "ok", token: payload.access_token, scope: payload.scope };
  }
  if (payload.error === "authorization_pending") return { status: "pending" };
  if (payload.error === "slow_down") {
    // Caller should respect the new interval; the next poll uses it.
    return { status: "pending" };
  }
  throw new Error(
    payload.error_description || payload.error || "Device flow failed"
  );
}

export async function loginDevice(
  hostInput: string,
  opts?: { onUserCode?: (info: DeviceCodePayload & { host: string }) => void }
): Promise<GhAccount> {
  const startInfo = await startDeviceFlow(hostInput);
  if (opts?.onUserCode) {
    opts.onUserCode(startInfo);
  } else {
    console.log(`\nVisit ${startInfo.verification_uri} and enter code: ${startInfo.user_code}`);
    console.log(`Waiting for authorization (expires in ${Math.round(startInfo.expires_in / 60)}m)...\n`);
  }

  const deadline = Date.now() + startInfo.expires_in * 1000;
  let interval = startInfo.interval || 5;

  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const r = await pollDeviceToken(startInfo.host, startInfo.device_code, interval);
    if (r.status === "ok" && r.token) {
      const client = createClient({
        authHeader: `token ${r.token}`,
        host: startInfo.host,
      });
      const viewer = await client.resolveViewer();
      insertAccount({
        host: startInfo.host,
        login: viewer.login,
        userNodeId: viewer.nodeId,
        authMethod: "device",
        token: r.token,
        tokenScopes: r.scope ?? viewer.scopes ?? null,
      });
      const acct = getAccount(startInfo.host, viewer.login);
      if (!acct) throw new Error("Failed to insert account");
      return acct;
    }
  }
  throw new Error("Device flow timed out before authorization completed");
}

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
