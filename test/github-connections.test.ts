import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

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
  await rm(testHome, { recursive: true, force: true });
  delete process.env["KNOTES_HOME"];
});

async function setupAccountAndJournal(): Promise<number> {
  const { insertAccount } = await import("../src/core/github/db.ts");
  const aid = insertAccount({
    host: "github.com",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "pat",
    token: "tok",
  });
  const { createLog } = await import("../src/core/logs.ts");
  await createLog("logs/work/activity", "Activity");
  return aid;
}

test("addConnection requires the log journal to exist", async () => {
  const { insertAccount } = await import("../src/core/github/db.ts");
  insertAccount({
    host: "github.com",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "pat",
    token: "tok",
  });

  const { addConnection } = await import("../src/core/github/connections.ts");
  await expect(
    addConnection({
      logPath: "logs/missing",
      host: "github.com",
      login: "alice",
      monitors: ["merged_prs"],
    })
  ).rejects.toThrow(/Log not found/);
});

test("addConnection requires path to start with logs/", async () => {
  await setupAccountAndJournal();
  const { addConnection } = await import("../src/core/github/connections.ts");
  await expect(
    addConnection({
      logPath: "notes/oops",
      host: "github.com",
      login: "alice",
      monitors: ["merged_prs"],
    })
  ).rejects.toThrow(/must start with logs\//);
});

test("addConnection requires a known account", async () => {
  const { createLog } = await import("../src/core/logs.ts");
  await createLog("logs/work/activity", "Activity");
  const { addConnection } = await import("../src/core/github/connections.ts");
  await expect(
    addConnection({
      logPath: "logs/work/activity",
      host: "github.com",
      login: "ghost",
      monitors: ["merged_prs"],
    })
  ).rejects.toThrow(/Account not found/);
});

test("addConnection lowercases org and repo filters", async () => {
  await setupAccountAndJournal();
  const { addConnection } = await import("../src/core/github/connections.ts");
  const conn = await addConnection({
    logPath: "logs/work/activity",
    host: "github.com",
    login: "alice",
    monitors: ["opened_prs", "merged_prs", "opened_issues", "pr_reviews"],
    includeOrgs: ["ACME", "Antrea-IO"],
    excludeRepos: ["Acme/Secret"],
  });
  expect(conn.includeOrgs).toEqual(["acme", "antrea-io"]);
  expect(conn.excludeRepos).toEqual(["acme/secret"]);
  expect(conn.monitors).toHaveLength(4);
});

test("addConnection defaults since to ~now-7d", async () => {
  await setupAccountAndJournal();
  const before = Date.now();
  const { addConnection } = await import("../src/core/github/connections.ts");
  const conn = await addConnection({
    logPath: "logs/work/activity",
    host: "github.com",
    login: "alice",
    monitors: ["merged_prs"],
  });
  const since = Date.parse(conn.since);
  expect(since).toBeLessThanOrEqual(before - 7 * 24 * 60 * 60 * 1000 + 1000);
  expect(since).toBeGreaterThan(before - 7 * 24 * 60 * 60 * 1000 - 60_000);
});

test("addConnection rejects empty / invalid monitor lists", async () => {
  await setupAccountAndJournal();
  const { addConnection } = await import("../src/core/github/connections.ts");
  await expect(
    addConnection({
      logPath: "logs/work/activity",
      host: "github.com",
      login: "alice",
      monitors: [],
    })
  ).rejects.toThrow(/at least one monitor/i);
  await expect(
    addConnection({
      logPath: "logs/work/activity",
      host: "github.com",
      login: "alice",
      monitors: ["bogus" as any],
    })
  ).rejects.toThrow(/Invalid monitor/);
});

test("addConnection re-run without --since preserves the stored cutoff", async () => {
  await setupAccountAndJournal();
  const { addConnection } = await import("../src/core/github/connections.ts");
  const explicit = "2026-01-01T00:00:00.000Z";
  const c1 = await addConnection({
    logPath: "logs/work/activity",
    host: "github.com",
    login: "alice",
    monitors: ["merged_prs"],
    since: explicit,
  });
  expect(c1.since).toBe(explicit);

  // Re-run with no `since` — should keep the stored value, not reset to now-7d.
  const c2 = await addConnection({
    logPath: "logs/work/activity",
    host: "github.com",
    login: "alice",
    monitors: ["opened_issues"],
  });
  expect(c2.id).toBe(c1.id);
  expect(c2.since).toBe(explicit);
});

test("addConnection re-run WITH --since updates the cutoff", async () => {
  await setupAccountAndJournal();
  const { addConnection } = await import("../src/core/github/connections.ts");
  const c1 = await addConnection({
    logPath: "logs/work/activity",
    host: "github.com",
    login: "alice",
    monitors: ["merged_prs"],
    since: "2026-01-01T00:00:00.000Z",
  });
  const c2 = await addConnection({
    logPath: "logs/work/activity",
    host: "github.com",
    login: "alice",
    monitors: ["merged_prs"],
    since: "2026-04-01T00:00:00.000Z",
  });
  expect(c2.id).toBe(c1.id);
  expect(c2.since).toBe("2026-04-01T00:00:00.000Z");
});

test("addConnection upserts on (logPath, account) — re-running updates filters", async () => {
  await setupAccountAndJournal();
  const { addConnection, listConnections } = await import(
    "../src/core/github/connections.ts"
  );
  const conn1 = await addConnection({
    logPath: "logs/work/activity",
    host: "github.com",
    login: "alice",
    monitors: ["merged_prs"],
  });
  const conn2 = await addConnection({
    logPath: "logs/work/activity",
    host: "github.com",
    login: "alice",
    monitors: ["opened_issues", "pr_reviews"],
    includeOrgs: ["acme"],
  });
  expect(conn2.id).toBe(conn1.id);

  const all = await listConnections("logs/work/activity");
  expect(all).toHaveLength(1);
  expect(all[0]!.monitors).toEqual(["opened_issues", "pr_reviews"]);
  expect(all[0]!.includeOrgs).toEqual(["acme"]);
});

test("removeConnection deletes by id", async () => {
  await setupAccountAndJournal();
  const { addConnection, removeConnection, listConnections } = await import(
    "../src/core/github/connections.ts"
  );
  const conn = await addConnection({
    logPath: "logs/work/activity",
    host: "github.com",
    login: "alice",
    monitors: ["merged_prs"],
  });
  await removeConnection(conn.id);
  expect(await listConnections()).toHaveLength(0);
});

test("router.updateGithubConnection patches selected fields and returns the updated row", async () => {
  await setupAccountAndJournal();
  const { setConfigValue } = await import("../src/core/db.ts");
  setConfigValue("serverless", "true");

  const { addConnection } = await import("../src/core/github/connections.ts");
  const conn = await addConnection({
    logPath: "logs/work/activity",
    host: "github.com",
    login: "alice",
    monitors: ["merged_prs"],
  });

  const router = await import("../src/core/router.ts");
  const updated = await router.updateGithubConnection(conn.id, {
    monitors: ["opened_prs", "pr_reviews"],
    enabled: false,
    bodyMode: "first_paragraph",
  });
  expect(updated.id).toBe(conn.id);
  expect(updated.monitors).toEqual(["opened_prs", "pr_reviews"]);
  expect(updated.enabled).toBe(false);
  expect(updated.bodyMode).toBe("first_paragraph");
});

test("removeConnection throws on missing id", async () => {
  const { removeConnection } = await import("../src/core/github/connections.ts");
  await expect(removeConnection(99999)).rejects.toThrow(/not found/);
});
