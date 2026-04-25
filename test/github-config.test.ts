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
  const { ensureHome } = await import("../src/core/config.ts");
  await ensureHome();
});

afterEach(async () => {
  const { resetDb } = await import("../src/core/db.ts");
  resetDb();
  await rm(testHome, { recursive: true, force: true });
  delete process.env["KNOTES_HOME"];
});

test("getConfig defaults: githubEnabled=true, githubSyncInterval=600", async () => {
  const { getConfig } = await import("../src/core/config.ts");
  const cfg = getConfig();
  expect(cfg.githubEnabled).toBe(true);
  expect(cfg.githubSyncInterval).toBe(600);
});

test("saveConfig persists githubEnabled and githubSyncInterval", async () => {
  const { saveConfig, getConfig } = await import("../src/core/config.ts");
  await saveConfig({ githubEnabled: false, githubSyncInterval: 1800 });
  const cfg = getConfig();
  expect(cfg.githubEnabled).toBe(false);
  expect(cfg.githubSyncInterval).toBe(1800);
});

test("getJobs filters github:sync jobs", async () => {
  const {
    recordJobStart,
    recordJobComplete,
    getJobs,
  } = await import("../src/core/db.ts");
  const j1 = recordJobStart("github:sync:logs/work");
  recordJobComplete(j1, 100, { pulled: 3, written: 3 });
  const j2 = recordJobStart("embed:background");
  recordJobComplete(j2, 50);

  const { jobs } = getJobs({ pageSize: 10, type: "github:sync" });
  expect(jobs).toHaveLength(1);
  expect(jobs[0]!.type).toBe("github:sync:logs/work");
  expect(jobs[0]!.metadata).toContain('"pulled":3');
});
