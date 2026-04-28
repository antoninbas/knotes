import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { GhApiError } from "../src/core/github/api.ts";
import type { GhClient } from "../src/core/github/api.ts";

let testHome: string;

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "knotes-test-"));
  process.env["KNOTES_HOME"] = testHome;
  const { resetConfigCache } = await import("../src/core/config.ts");
  resetConfigCache();
  const { resetDb } = await import("../src/core/db.ts");
  resetDb();
  const { resetStore } = await import("../src/core/search.ts");
  resetStore();
  const { ensureHome } = await import("../src/core/config.ts");
  await ensureHome();
});

afterEach(async () => {
  const { resetDb } = await import("../src/core/db.ts");
  resetDb();
  const { resetVaultCache } = await import("../src/core/vault.ts");
  resetVaultCache();
  await rm(testHome, { recursive: true, force: true });
  delete process.env["KNOTES_HOME"];
});

function makeFailingClient(status: number): GhClient {
  return {
    async graphql() {
      throw new GhApiError(status, `GitHub GraphQL ${status}`, { message: "fail" });
    },
    async rest() {
      throw new Error("not used");
    },
    rateLimitInfo() {
      return { remaining: 5000, resetAt: null, graphQLCost: null, graphQLRemaining: null, graphQLResetAt: null };
    },
    async resolveViewer() {
      return { login: "alice", nodeId: "U_1", scopes: null };
    },
  };
}

async function setupAccountAndConnection(): Promise<number> {
  const { insertAccount } = await import("../src/core/github/db.ts");
  insertAccount({
    host: "github.com",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "pat",
  });
  const { createLog } = await import("../src/core/logs.ts");
  await createLog("logs/work/activity", "Activity");
  const { addConnection } = await import("../src/core/github/connections.ts");
  const conn = await addConnection({
    logPath: "logs/work/activity",
    host: "github.com",
    login: "alice",
    monitors: ["opened_prs"],
    since: "2026-04-01T00:00:00Z",
  });
  return conn.id;
}

test("syncConnection marks account as needsReauth on 401 and skips subsequent runs", async () => {
  const cid = await setupAccountAndConnection();
  const { syncConnection } = await import("../src/core/github/sync.ts");
  const { getAccountById } = await import("../src/core/github/db.ts");

  const r1 = await syncConnection(cid, makeFailingClient(401));
  expect(r1.authError).toBe(true);
  expect(r1.pulled).toBe(0);

  const acct = getAccountById(1);
  expect(acct!.needsReauth).toBe(true);

  // Second run should be skipped without even calling the client.
  const r2 = await syncConnection(cid, makeFailingClient(401));
  expect(r2.authError).toBe(true);
  expect(r2.pulled).toBe(0);
});

test("loginPat clears needsReauth flag after successful re-auth", async () => {
  const cid = await setupAccountAndConnection();
  const { syncConnection } = await import("../src/core/github/sync.ts");
  const { getAccountById } = await import("../src/core/github/db.ts");

  await syncConnection(cid, makeFailingClient(401));
  let acct = getAccountById(1);
  expect(acct!.needsReauth).toBe(true);

  // Re-authenticate with a working token.
  const { loginPat } = await import("../src/core/github/auth.ts");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ login: "alice", node_id: "U_1" }), {
      status: 200,
      headers: { "content-type": "application/json", "x-oauth-scopes": "repo" },
    });
  try {
    await loginPat("github.com", "new_token");
  } finally {
    globalThis.fetch = originalFetch;
  }

  acct = getAccountById(1);
  expect(acct!.needsReauth).toBe(false);
});
