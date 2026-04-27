import { Hono } from "hono";
import { z } from "zod";
import { ensureHome } from "../../core/config.ts";
import {
  addConnection,
  listConnections,
  removeConnection,
  updateConnection,
  listAccounts,
  logout,
} from "../../core/github/connections.ts";
import { loginPat, loginGhCli, startDeviceFlow, pollDeviceToken } from "../../core/github/auth.ts";
import { createClient, normalizeHost } from "../../core/github/api.ts";
import { insertAccount, getAccount } from "../../core/github/db.ts";
import { syncAll, syncConnection, syncForLog } from "../../core/github/sync.ts";
import { getJobs } from "../../core/db.ts";
import { setToken, VaultLockedError } from "../../core/vault.ts";

const MonitorSchema = z.enum([
  "opened_prs",
  "merged_prs",
  "opened_issues",
  "pr_reviews",
]);

const BodyModeSchema = z.enum([
  "title",
  "full",
  "first_paragraph",
  "first_chars",
]);

const PatLoginSchema = z.object({
  host: z.string().min(1),
  token: z.string().min(1),
});

const GhCliLoginSchema = z.object({
  host: z.string().min(1),
});

const LogoutSchema = z.object({
  host: z.string().min(1),
  login: z.string().min(1),
});

const CreateConnectionSchema = z.object({
  logPath: z.string().min(1),
  host: z.string().min(1),
  login: z.string().min(1),
  monitors: z.array(MonitorSchema).min(1),
  includeOrgs: z.array(z.string()).optional(),
  excludeOrgs: z.array(z.string()).optional(),
  includeRepos: z.array(z.string()).optional(),
  excludeRepos: z.array(z.string()).optional(),
  since: z.string().optional(),
  bodyMode: BodyModeSchema.optional(),
  bodyMaxChars: z.number().int().positive().nullable().optional(),
  syncNow: z.boolean().optional(),
});

const DeviceStartSchema = z.object({
  host: z.string().min(1),
  clientId: z.string().optional(),
});

const DevicePollSchema = z.object({
  host: z.string().min(1),
  device_code: z.string().min(1),
  clientId: z.string().optional(),
  interval: z.number().int().positive().optional(),
});

const SyncSchema = z.object({
  logPath: z.string().optional(),
  connectionId: z.number().int().positive().optional(),
});

const UpdateConnectionSchema = z.object({
  monitors: z.array(MonitorSchema).optional(),
  includeOrgs: z.array(z.string()).nullable().optional(),
  excludeOrgs: z.array(z.string()).nullable().optional(),
  includeRepos: z.array(z.string()).nullable().optional(),
  excludeRepos: z.array(z.string()).nullable().optional(),
  since: z.string().optional(),
  enabled: z.boolean().optional(),
  bodyMode: BodyModeSchema.optional(),
  bodyMaxChars: z.number().int().positive().nullable().optional(),
  syncNow: z.boolean().optional(),
});

export const githubApi = new Hono();

githubApi.get("/accounts", async (c) => {
  await ensureHome();
  const accounts = await listAccounts();
  return c.json(accounts);
});

githubApi.delete("/accounts", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = LogoutSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      400
    );
  }
  try {
    await logout(parsed.data.host, parsed.data.login);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});

githubApi.post("/auth/pat", async (c) => {
  await ensureHome();
  const raw = await c.req.json().catch(() => null);
  const parsed = PatLoginSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      400
    );
  }
  try {
    const acct = await loginPat(parsed.data.host, parsed.data.token);
    return c.json(acct, 201);
  } catch (err: any) {
    if (err instanceof VaultLockedError) {
      return c.json({ error: err.message, unlockHint: "Run knotes vault unlock or set KNOTES_VAULT_PASSPHRASE" }, 423);
    }
    return c.json({ error: err.message }, 400);
  }
});

githubApi.post("/auth/device/start", async (c) => {
  await ensureHome();
  const raw = await c.req.json().catch(() => null);
  const parsed = DeviceStartSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      400
    );
  }
  try {
    const info = await startDeviceFlow(parsed.data.host, {
      clientId: parsed.data.clientId,
    });
    return c.json(info);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

githubApi.post("/auth/device/poll", async (c) => {
  await ensureHome();
  const raw = await c.req.json().catch(() => null);
  const parsed = DevicePollSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      400
    );
  }
  const host = normalizeHost(parsed.data.host);
  try {
    const result = await pollDeviceToken(
      host,
      parsed.data.device_code,
      parsed.data.interval ?? 5,
      { clientId: parsed.data.clientId }
    );
    if (result.status === "pending") {
      return c.json({
        status: "pending",
        ...(result.newInterval ? { newInterval: result.newInterval } : {}),
      });
    }
    const client = createClient({
      authHeader: `token ${result.token}`,
      host,
    });
    const viewer = await client.resolveViewer();
    insertAccount({
      host,
      login: viewer.login,
      userNodeId: viewer.nodeId,
      authMethod: "device",
      tokenScopes: result.scope ?? viewer.scopes ?? null,
      clientId: parsed.data.clientId ?? null,
    });
    setToken(host, viewer.login, result.token!);
    const acct = getAccount(host, viewer.login)!;
    return c.json({ status: "ok", account: acct });
  } catch (err: any) {
    if (err instanceof VaultLockedError) {
      return c.json({ error: err.message, unlockHint: "Run knotes vault unlock or set KNOTES_VAULT_PASSPHRASE" }, 423);
    }
    return c.json({ error: err.message }, 400);
  }
});

githubApi.post("/auth/gh-cli", async (c) => {
  await ensureHome();
  const raw = await c.req.json().catch(() => null);
  const parsed = GhCliLoginSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      400
    );
  }
  try {
    const acct = await loginGhCli(parsed.data.host);
    return c.json(acct, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

githubApi.get("/connections", async (c) => {
  const logPath = c.req.query("logPath");
  const conns = await listConnections(logPath || undefined);
  return c.json(conns);
});

githubApi.post("/connections", async (c) => {
  await ensureHome();
  const raw = await c.req.json().catch(() => null);
  const parsed = CreateConnectionSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      400
    );
  }
  try {
    const { syncNow, ...input } = parsed.data;
    const conn = await addConnection(input);
    let syncResult = null;
    if (syncNow) {
      try {
        syncResult = await syncConnection(conn.id, undefined, "manual");
      } catch (err: any) {
        syncResult = { error: err.message };
      }
    }
    return c.json({ connection: conn, syncResult }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

githubApi.put("/connections/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (Number.isNaN(id)) return c.json({ error: "Invalid connection id" }, 400);
  const raw = await c.req.json().catch(() => null);
  const parsed = UpdateConnectionSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      400
    );
  }
  try {
    const { syncNow, ...patch } = parsed.data;
    const conn = await updateConnection(id, patch);
    let syncResult = null;
    if (syncNow) {
      try {
        syncResult = await syncConnection(conn.id, undefined, "manual");
      } catch (err: any) {
        syncResult = { error: err.message };
      }
    }
    return c.json({ connection: conn, syncResult });
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});

githubApi.get("/sync/status", async (c) => {
  const limit = parseInt(c.req.query("limit") || "20", 10);
  const { jobs } = getJobs({ pageSize: limit, type: "github:sync" });
  return c.json(jobs);
});

githubApi.post("/sync", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = SyncSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      400
    );
  }
  try {
    let results;
    if (parsed.data.connectionId !== undefined) {
      results = [await syncConnection(parsed.data.connectionId, undefined, "manual")];
    } else if (parsed.data.logPath) {
      results = await syncForLog(parsed.data.logPath);
    } else {
      results = await syncAll({ trigger: "manual" });
    }
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

githubApi.delete("/connections/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (Number.isNaN(id)) return c.json({ error: "Invalid connection id" }, 400);
  try {
    await removeConnection(id);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});
