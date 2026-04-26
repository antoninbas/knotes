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
 * Built-in OAuth App client_ids for Device Flow, keyed by host. Public —
 * Device Flow does not use a client secret, so it's safe to ship these in
 * source. Empty by default: until a knotes-owned OAuth App is registered
 * on github.com, every device-flow login must pass --client-id explicitly.
 *
 * For self-hosted GHES instances, the user always provides their own
 * client_id (you can't pre-register apps on every GHES install).
 */
const BUILTIN_GITHUB_CLIENT_IDS: Record<string, string> = {
  "github.com": "Ov23licq0sDVhDGRvnoj",
};

function resolveClientId(host: string, override?: string | null): string | null {
  if (override) return override;
  return BUILTIN_GITHUB_CLIENT_IDS[host] ?? null;
}

function clientIdMissingError(host: string): Error {
  const settingsPath =
    host === "github.com"
      ? "https://github.com/settings/applications/new"
      : `https://${host}/settings/applications/new`;
  return new Error(
    `Device flow on ${host} requires an OAuth App client_id. ` +
    `Register one at ${settingsPath} (enable "Device Flow" on the app's settings page) ` +
    `and re-run with --client-id <id>. Or use --method pat / --method gh.`
  );
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
  opts?: { clientId?: string | null; scope?: string }
): Promise<DeviceCodePayload & { host: string; clientId: string }> {
  const host = normalizeHost(hostInput);
  const clientId = resolveClientId(host, opts?.clientId);
  if (!clientId) throw clientIdMissingError(host);
  const scope = opts?.scope ?? "repo read:user read:org";
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
  return { ...payload, host, clientId };
}

export async function pollDeviceToken(
  host: string,
  deviceCode: string,
  intervalSec: number,
  opts?: { clientId?: string | null }
): Promise<{
  status: "pending" | "ok";
  token?: string;
  scope?: string;
  newInterval?: number;
}> {
  const clientId = resolveClientId(host, opts?.clientId);
  if (!clientId) throw clientIdMissingError(host);
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
    // RFC 8628 §3.5: bump interval by GitHub's hint, or by 5s as a safe default.
    const bump = payload.interval ?? 5;
    return { status: "pending", newInterval: intervalSec + bump };
  }
  throw new Error(
    payload.error_description || payload.error || "Device flow failed"
  );
}

export async function loginDevice(
  hostInput: string,
  opts?: {
    clientId?: string | null;
    onUserCode?: (info: DeviceCodePayload & { host: string }) => void;
  }
): Promise<GhAccount> {
  const startInfo = await startDeviceFlow(hostInput, { clientId: opts?.clientId });
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
    const r = await pollDeviceToken(startInfo.host, startInfo.device_code, interval, {
      clientId: startInfo.clientId,
    });
    if (r.newInterval) interval = r.newInterval;
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
        clientId: startInfo.clientId,
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
