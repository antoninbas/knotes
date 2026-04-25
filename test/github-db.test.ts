import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { statSync } from "node:fs";

let testHome: string;

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "knotes-test-"));
  process.env["KNOTES_HOME"] = testHome;
  const { resetConfigCache } = await import("../src/core/config.ts");
  resetConfigCache();
  const { resetDb } = await import("../src/core/db.ts");
  resetDb();
  const { ensureHome } = await import("../src/core/config.ts");
  await ensureHome();
});

afterEach(async () => {
  const { resetDb } = await import("../src/core/db.ts");
  resetDb();
  await rm(testHome, { recursive: true, force: true });
  delete process.env["KNOTES_HOME"];
});

test("getDb sets the SQLite file mode to 0600", async () => {
  const { getDb } = await import("../src/core/db.ts");
  getDb();
  const dbPath = join(testHome, ".data/knotes.sqlite");
  // POSIX permission bits only — masking out file-type bits.
  if (process.platform !== "win32") {
    const mode = statSync(dbPath).mode & 0o777;
    expect(mode).toBe(0o600);
  }
});

test("insertAccount + getAccount round-trip", async () => {
  const { insertAccount, getAccount } = await import("../src/core/github/db.ts");
  const id = insertAccount({
    host: "github.com",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "pat",
    token: "ghp_test123",
    tokenScopes: "repo,read:user",
  });
  expect(id).toBeGreaterThan(0);

  const acct = getAccount("github.com", "alice");
  expect(acct).not.toBeNull();
  expect(acct!.login).toBe("alice");
  expect(acct!.authMethod).toBe("pat");
  expect(acct!.tokenScopes).toBe("repo,read:user");
});

test("insertAccount upserts on (host, login) conflict", async () => {
  const { insertAccount, getAccount, listAccounts } = await import(
    "../src/core/github/db.ts"
  );
  const id1 = insertAccount({
    host: "github.com",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "pat",
    token: "v1",
  });
  const id2 = insertAccount({
    host: "github.com",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "device",
    token: "v2",
  });
  expect(id2).toBe(id1);

  const acct = getAccount("github.com", "alice")!;
  expect(acct.authMethod).toBe("device");
  expect(listAccounts()).toHaveLength(1);
});

test("readToken returns the stored plaintext token", async () => {
  const { insertAccount, readToken } = await import("../src/core/github/db.ts");
  const id = insertAccount({
    host: "github.com",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "pat",
    token: "secret-token",
  });
  expect(readToken(id)).toBe("secret-token");
});

test("deleteAccount cascades to connections", async () => {
  const { insertAccount, deleteAccount } = await import(
    "../src/core/github/db.ts"
  );
  const { insertConnection, listConnections } = await import(
    "../src/core/github/db.ts"
  );
  const aid = insertAccount({
    host: "github.com",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "pat",
    token: "t",
  });
  insertConnection({
    logPath: "logs/work",
    accountId: aid,
    monitors: ["merged_prs"],
    since: "2026-04-01T00:00:00Z",
  });
  expect(listConnections()).toHaveLength(1);

  deleteAccount(aid);
  expect(listConnections()).toHaveLength(0);
});

test("insertConnection round-trips JSON-encoded fields", async () => {
  const { insertAccount } = await import("../src/core/github/db.ts");
  const { insertConnection, getConnection } = await import(
    "../src/core/github/db.ts"
  );
  const aid = insertAccount({
    host: "github.com",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "pat",
    token: "t",
  });
  const cid = insertConnection({
    logPath: "logs/work/activity",
    accountId: aid,
    monitors: ["opened_prs", "merged_prs", "opened_issues", "pr_reviews"],
    includeOrgs: ["acme", "antrea-io"],
    excludeRepos: ["acme/private-repo"],
    since: "2026-04-01T00:00:00Z",
  });

  const conn = getConnection(cid)!;
  expect(conn.monitors).toEqual([
    "opened_prs",
    "merged_prs",
    "opened_issues",
    "pr_reviews",
  ]);
  expect(conn.includeOrgs).toEqual(["acme", "antrea-io"]);
  expect(conn.excludeRepos).toEqual(["acme/private-repo"]);
  expect(conn.includeRepos).toBeNull();
  expect(conn.enabled).toBe(true);
});

test("insertConnection upserts on (logPath, accountId) conflict", async () => {
  const { insertAccount, insertConnection, getConnection } = await import(
    "../src/core/github/db.ts"
  );
  const aid = insertAccount({
    host: "github.com",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "pat",
    token: "t",
  });
  const cid1 = insertConnection({
    logPath: "logs/work",
    accountId: aid,
    monitors: ["merged_prs"],
    since: "2026-04-01T00:00:00Z",
  });
  const cid2 = insertConnection({
    logPath: "logs/work",
    accountId: aid,
    monitors: ["opened_issues", "pr_reviews"],
    since: "2026-04-15T00:00:00Z",
  });
  expect(cid2).toBe(cid1);

  const conn = getConnection(cid1)!;
  expect(conn.monitors).toEqual(["opened_issues", "pr_reviews"]);
  expect(conn.since).toBe("2026-04-15T00:00:00Z");
});

test("updateConnection patches selected fields", async () => {
  const { insertAccount, insertConnection, updateConnection, getConnection } =
    await import("../src/core/github/db.ts");
  const aid = insertAccount({
    host: "github.com",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "pat",
    token: "t",
  });
  const cid = insertConnection({
    logPath: "logs/work",
    accountId: aid,
    monitors: ["merged_prs"],
    since: "2026-04-01T00:00:00Z",
  });

  updateConnection(cid, {
    enabled: false,
    lastSyncedAt: "2026-04-24T12:00:00Z",
    excludeOrgs: ["bots"],
  });

  const conn = getConnection(cid)!;
  expect(conn.enabled).toBe(false);
  expect(conn.lastSyncedAt).toBe("2026-04-24T12:00:00Z");
  expect(conn.excludeOrgs).toEqual(["bots"]);
  expect(conn.monitors).toEqual(["merged_prs"]);
});

test("upsertSyncedEvent and getSyncedEvent round-trip", async () => {
  const { insertAccount, insertConnection } = await import(
    "../src/core/github/db.ts"
  );
  const { upsertSyncedEvent, getSyncedEvent } = await import(
    "../src/core/github/db.ts"
  );
  const aid = insertAccount({
    host: "github.com",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "pat",
    token: "t",
  });
  const cid = insertConnection({
    logPath: "logs/work",
    accountId: aid,
    monitors: ["merged_prs"],
    since: "2026-04-01T00:00:00Z",
  });

  upsertSyncedEvent({
    connectionId: cid,
    eventId: "pr:PR_NODE_1",
    entryId: "e-0123456789abcdef",
    timestamp: "2026-04-23T10:00:00Z",
    stateHash: "abc123",
    url: "https://github.com/acme/repo/pull/1",
  });

  const evt = getSyncedEvent(cid, "pr:PR_NODE_1")!;
  expect(evt.entryId).toBe("e-0123456789abcdef");
  expect(evt.stateHash).toBe("abc123");

  // Update — different hash + later timestamp
  upsertSyncedEvent({
    connectionId: cid,
    eventId: "pr:PR_NODE_1",
    entryId: "e-0123456789abcdef",
    timestamp: "2026-04-25T14:00:00Z",
    stateHash: "def456",
    url: "https://github.com/acme/repo/pull/1",
  });
  const evt2 = getSyncedEvent(cid, "pr:PR_NODE_1")!;
  expect(evt2.timestamp).toBe("2026-04-25T14:00:00Z");
  expect(evt2.stateHash).toBe("def456");
});

test("deleteConnection cascades to synced events", async () => {
  const { insertAccount, insertConnection, deleteConnection } = await import(
    "../src/core/github/db.ts"
  );
  const { upsertSyncedEvent, listSyncedEvents } = await import(
    "../src/core/github/db.ts"
  );
  const aid = insertAccount({
    host: "github.com",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "pat",
    token: "t",
  });
  const cid = insertConnection({
    logPath: "logs/work",
    accountId: aid,
    monitors: ["merged_prs"],
    since: "2026-04-01T00:00:00Z",
  });
  upsertSyncedEvent({
    connectionId: cid,
    eventId: "pr:N1",
    entryId: "e-0000000000000001",
    timestamp: "2026-04-23T10:00:00Z",
    stateHash: "h1",
  });
  expect(listSyncedEvents(cid)).toHaveLength(1);

  deleteConnection(cid);
  expect(listSyncedEvents(cid)).toHaveLength(0);
});
