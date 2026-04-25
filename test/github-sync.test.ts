import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
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
  await rm(testHome, { recursive: true, force: true });
  delete process.env["KNOTES_HOME"];
});

interface PRFixture {
  id: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  additions: number;
  deletions: number;
  baseRefName: string;
  repository: { name: string; nameWithOwner: string; owner: { login: string } };
}

function makeStubClient(prs: PRFixture[]): GhClient {
  const calls: string[] = [];
  const client: GhClient = {
    async graphql(query: string) {
      calls.push(query.slice(0, 40));
      // We only stub the PR search query.
      if (query.includes("search(type: ISSUE")) {
        return {
          search: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: prs,
          },
        } as any;
      }
      return { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } as any;
    },
    async rest() {
      throw new Error("not used in this test");
    },
    rateLimitInfo() {
      return { remaining: 5000, resetAt: null };
    },
    async resolveViewer() {
      return { login: "alice", nodeId: "U_1", scopes: null };
    },
  };
  (client as any).__calls = calls;
  return client;
}

async function setupAccountAndConnection(monitors: string[]): Promise<number> {
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
  const { addConnection } = await import("../src/core/github/connections.ts");
  const conn = await addConnection({
    logPath: "logs/work/activity",
    host: "github.com",
    login: "alice",
    monitors: monitors as any,
    since: "2026-04-01T00:00:00Z",
  });
  return conn.id;
}

const REPO = {
  name: "thing",
  nameWithOwner: "acme/thing",
  owner: { login: "acme" },
};

test("syncConnection writes one entry per PR; second run is a no-op", async () => {
  const cid = await setupAccountAndConnection(["opened_prs", "merged_prs"]);
  const prs: PRFixture[] = [
    {
      id: "PR_1",
      number: 1,
      title: "First",
      url: "https://github.com/acme/thing/pull/1",
      state: "MERGED",
      isDraft: false,
      createdAt: "2026-04-15T10:00:00Z",
      updatedAt: "2026-04-15T10:00:00Z",
      mergedAt: "2026-04-15T10:00:00Z",
      closedAt: "2026-04-15T10:00:00Z",
      additions: 10,
      deletions: 2,
      baseRefName: "main",
      repository: REPO,
    },
    {
      id: "PR_2",
      number: 2,
      title: "Second",
      url: "https://github.com/acme/thing/pull/2",
      state: "OPEN",
      isDraft: false,
      createdAt: "2026-04-22T10:00:00Z",
      updatedAt: "2026-04-22T10:00:00Z",
      mergedAt: null,
      closedAt: null,
      additions: 5,
      deletions: 0,
      baseRefName: "main",
      repository: REPO,
    },
  ];
  const { syncConnection } = await import("../src/core/github/sync.ts");
  const r1 = await syncConnection(cid, makeStubClient(prs));
  expect(r1.pulled).toBe(2);
  expect(r1.written).toBe(2);
  expect(r1.updated).toBe(0);
  expect(r1.skipped).toBe(0);

  const md1 = await readFile(join(testHome, "logs/work/activity.md"), "utf-8");
  expect(md1.match(/^## /gm)?.length).toBe(2);

  // Re-run with the same fixtures — same content, same hash, all skipped.
  const r2 = await syncConnection(cid, makeStubClient(prs));
  expect(r2.pulled).toBe(2);
  expect(r2.written).toBe(0);
  expect(r2.updated).toBe(0);
  expect(r2.skipped).toBe(2);

  const md2 = await readFile(join(testHome, "logs/work/activity.md"), "utf-8");
  // Body content is unchanged.
  const stripModified = (s: string) => s.replace(/^modified:.*$/gm, "");
  expect(stripModified(md2)).toBe(stripModified(md1));
});

test("syncConnection updates the same entry when a PR transitions OPEN → MERGED", async () => {
  const cid = await setupAccountAndConnection(["opened_prs", "merged_prs"]);
  const opened: PRFixture[] = [
    {
      id: "PR_X",
      number: 9,
      title: "Refactor",
      url: "https://github.com/acme/thing/pull/9",
      state: "OPEN",
      isDraft: false,
      createdAt: "2026-04-10T08:00:00Z",
      updatedAt: "2026-04-10T08:00:00Z",
      mergedAt: null,
      closedAt: null,
      additions: 30,
      deletions: 8,
      baseRefName: "main",
      repository: REPO,
    },
  ];
  const merged: PRFixture[] = [
    {
      ...opened[0]!,
      state: "MERGED",
      mergedAt: "2026-04-23T14:30:00Z",
      closedAt: "2026-04-23T14:30:00Z",
      updatedAt: "2026-04-23T14:30:00Z",
    },
  ];

  const { syncConnection } = await import("../src/core/github/sync.ts");
  const { listEntries } = await import("../src/core/logs.ts");
  const { getSyncedEvent } = await import("../src/core/github/db.ts");

  const r1 = await syncConnection(cid, makeStubClient(opened));
  expect(r1.written).toBe(1);
  let entries = await listEntries("logs/work/activity");
  expect(entries).toHaveLength(1);
  const firstId = entries[0]!.id;
  expect(entries[0]!.content).toContain("**Opened PR**");
  expect(entries[0]!.timestamp).toBe("2026-04-10T08:00:00Z");

  const r2 = await syncConnection(cid, makeStubClient(merged));
  expect(r2.written).toBe(0);
  expect(r2.updated).toBe(1);

  entries = await listEntries("logs/work/activity");
  expect(entries).toHaveLength(1);
  expect(entries[0]!.id).toBe(firstId);
  expect(entries[0]!.content).toContain("**Merged PR**");
  expect(entries[0]!.timestamp).toBe("2026-04-23T14:30:00Z");

  const evt = getSyncedEvent(cid, "pr:PR_X");
  expect(evt!.entryId).toBe(firstId);
});

test("syncConnection rewrites the same entry when a PR title changes (same state)", async () => {
  const cid = await setupAccountAndConnection(["opened_prs", "merged_prs"]);
  const v1: PRFixture[] = [
    {
      id: "PR_TITLE",
      number: 100,
      title: "Original title",
      url: "https://github.com/acme/thing/pull/100",
      state: "OPEN",
      isDraft: false,
      createdAt: "2026-04-20T08:00:00Z",
      updatedAt: "2026-04-20T08:00:00Z",
      mergedAt: null,
      closedAt: null,
      additions: 5,
      deletions: 1,
      baseRefName: "main",
      repository: REPO,
    },
  ];
  // Same node_id, same state, only the title (and updatedAt) changed.
  const v2: PRFixture[] = [
    {
      ...v1[0]!,
      title: "Renamed title with more detail",
      updatedAt: "2026-04-23T09:30:00Z",
    },
  ];

  const { syncConnection } = await import("../src/core/github/sync.ts");
  const { listEntries } = await import("../src/core/logs.ts");
  const { getSyncedEvent } = await import("../src/core/github/db.ts");

  const r1 = await syncConnection(cid, makeStubClient(v1));
  expect(r1.written).toBe(1);
  let entries = await listEntries("logs/work/activity");
  expect(entries).toHaveLength(1);
  const firstId = entries[0]!.id;
  expect(entries[0]!.content).toContain("Original title");
  const hashBefore = getSyncedEvent(cid, "pr:PR_TITLE")!.stateHash;

  const r2 = await syncConnection(cid, makeStubClient(v2));
  expect(r2.pulled).toBe(1);
  expect(r2.written).toBe(0);
  expect(r2.updated).toBe(1);
  expect(r2.skipped).toBe(0);

  entries = await listEntries("logs/work/activity");
  expect(entries).toHaveLength(1);
  expect(entries[0]!.id).toBe(firstId);
  expect(entries[0]!.content).toContain("Renamed title with more detail");
  expect(entries[0]!.content).not.toContain("Original title");

  // State is still OPEN, so the entry's timestamp stays at createdAt — a
  // title edit isn't "activity that bumps the entry up the journal".
  expect(entries[0]!.timestamp).toBe("2026-04-20T08:00:00Z");

  const hashAfter = getSyncedEvent(cid, "pr:PR_TITLE")!.stateHash;
  expect(hashAfter).not.toBe(hashBefore);
});

test("syncConnection with only merged_prs skips OPEN and CLOSED PRs", async () => {
  const cid = await setupAccountAndConnection(["merged_prs"]);
  const prs: PRFixture[] = [
    {
      id: "PR_OPEN",
      number: 1,
      title: "Open",
      url: "https://github.com/acme/thing/pull/1",
      state: "OPEN",
      isDraft: false,
      createdAt: "2026-04-22T10:00:00Z",
      updatedAt: "2026-04-22T10:00:00Z",
      mergedAt: null,
      closedAt: null,
      additions: 1,
      deletions: 0,
      baseRefName: "main",
      repository: REPO,
    },
    {
      id: "PR_MERGED",
      number: 2,
      title: "Merged",
      url: "https://github.com/acme/thing/pull/2",
      state: "MERGED",
      isDraft: false,
      createdAt: "2026-04-22T11:00:00Z",
      updatedAt: "2026-04-22T11:00:00Z",
      mergedAt: "2026-04-22T11:00:00Z",
      closedAt: "2026-04-22T11:00:00Z",
      additions: 1,
      deletions: 0,
      baseRefName: "main",
      repository: REPO,
    },
    {
      id: "PR_CLOSED",
      number: 3,
      title: "Closed",
      url: "https://github.com/acme/thing/pull/3",
      state: "CLOSED",
      isDraft: false,
      createdAt: "2026-04-22T12:00:00Z",
      updatedAt: "2026-04-22T12:00:00Z",
      mergedAt: null,
      closedAt: "2026-04-22T12:30:00Z",
      additions: 1,
      deletions: 0,
      baseRefName: "main",
      repository: REPO,
    },
  ];
  const { syncConnection } = await import("../src/core/github/sync.ts");
  const r = await syncConnection(cid, makeStubClient(prs));
  expect(r.pulled).toBe(1);
  expect(r.written).toBe(1);

  const { listEntries } = await import("../src/core/logs.ts");
  const entries = await listEntries("logs/work/activity");
  expect(entries).toHaveLength(1);
  expect(entries[0]!.content).toContain("**Merged PR**");
  expect(entries[0]!.content).toContain("acme/thing#2");
});

test("syncConnection respects exclude-org filter", async () => {
  const cid = await setupAccountAndConnection(["merged_prs"]);
  const { updateConnection } = await import("../src/core/github/connections.ts");
  await updateConnection(cid, { excludeOrgs: ["bots"] });

  const prs: PRFixture[] = [
    {
      id: "PR_A",
      number: 1,
      title: "Keep",
      url: "https://github.com/acme/thing/pull/1",
      state: "MERGED",
      isDraft: false,
      createdAt: "2026-04-22T10:00:00Z",
      updatedAt: "2026-04-22T10:00:00Z",
      mergedAt: "2026-04-22T10:00:00Z",
      closedAt: "2026-04-22T10:00:00Z",
      additions: 1,
      deletions: 0,
      baseRefName: "main",
      repository: REPO,
    },
    {
      id: "PR_B",
      number: 2,
      title: "Skip",
      url: "https://github.com/bots/scripts/pull/2",
      state: "MERGED",
      isDraft: false,
      createdAt: "2026-04-22T11:00:00Z",
      updatedAt: "2026-04-22T11:00:00Z",
      mergedAt: "2026-04-22T11:00:00Z",
      closedAt: "2026-04-22T11:00:00Z",
      additions: 1,
      deletions: 0,
      baseRefName: "main",
      repository: {
        name: "scripts",
        nameWithOwner: "bots/scripts",
        owner: { login: "bots" },
      },
    },
  ];
  const { syncConnection } = await import("../src/core/github/sync.ts");
  const r = await syncConnection(cid, makeStubClient(prs));
  expect(r.pulled).toBe(2);
  expect(r.written).toBe(1);
  expect(r.skipped).toBe(1);

  const { listEntries } = await import("../src/core/logs.ts");
  const entries = await listEntries("logs/work/activity");
  expect(entries).toHaveLength(1);
  expect(entries[0]!.content).toContain("acme/thing#1");
});

test("upsertEntryFromSource keeps newest-first order when backfilling old entries", async () => {
  const { createLog, addEntry, upsertEntryFromSource, listEntries } = await import(
    "../src/core/logs.ts"
  );
  await createLog("logs/work/activity", "Activity");
  await addEntry("logs/work/activity", "live entry one");
  await addEntry("logs/work/activity", "live entry two");
  await addEntry("logs/work/activity", "live entry three");

  await upsertEntryFromSource("logs/work/activity", {
    timestamp: "2020-01-01T00:00:00Z",
    content: "old backfilled",
  });
  await upsertEntryFromSource("logs/work/activity", {
    timestamp: "2099-01-01T00:00:00Z",
    content: "future entry",
  });

  const entries = await listEntries("logs/work/activity");
  expect(entries).toHaveLength(5);
  expect(entries[0]!.content).toBe("future entry");
  expect(entries[entries.length - 1]!.content).toBe("old backfilled");
  // Confirm strict descending timestamp order.
  for (let i = 1; i < entries.length; i++) {
    const prev = new Date(entries[i - 1]!.timestamp).getTime();
    const cur = new Date(entries[i]!.timestamp).getTime();
    expect(prev).toBeGreaterThanOrEqual(cur);
  }
});

test("two concurrent syncConnection calls coalesce; entries are not duplicated", async () => {
  const cid = await setupAccountAndConnection(["opened_prs", "merged_prs"]);
  const prs: PRFixture[] = [
    {
      id: "PR_RACE",
      number: 1,
      title: "Race",
      url: "https://github.com/acme/thing/pull/1",
      state: "OPEN",
      isDraft: false,
      createdAt: "2026-04-22T10:00:00Z",
      updatedAt: "2026-04-22T10:00:00Z",
      mergedAt: null,
      closedAt: null,
      additions: 1,
      deletions: 0,
      baseRefName: "main",
      repository: REPO,
    },
  ];
  const { syncConnection } = await import("../src/core/github/sync.ts");
  // Two clients firing in the same tick.
  const [r1, r2] = await Promise.all([
    syncConnection(cid, makeStubClient(prs)),
    syncConnection(cid, makeStubClient(prs)),
  ]);
  // The two callers may receive the same coalesced result or one written + one
  // skipped (depending on timing); the invariant is that there's exactly one
  // entry on disk.
  const total = (r1.written + r2.written) + (r1.skipped + r2.skipped);
  expect(total).toBeGreaterThan(0);

  const { listEntries } = await import("../src/core/logs.ts");
  const entries = await listEntries("logs/work/activity");
  expect(entries).toHaveLength(1);
});

test("syncConnection adopts an existing entry by gh-event marker when DB row is missing", async () => {
  const cid = await setupAccountAndConnection(["opened_prs", "merged_prs"]);
  const { upsertEntryFromSource, listEntries } = await import("../src/core/logs.ts");

  // Pre-seed the markdown with an entry carrying the exact marker.
  await upsertEntryFromSource("logs/work/activity", {
    timestamp: "2026-04-20T10:00:00Z",
    content:
      "**Opened PR** [acme/thing#1 — Old](https://github.com/acme/thing/pull/1)\n\nState: OPEN\n\n<!-- gh-event:pr:PR_RECOVERY -->",
  });
  const before = await listEntries("logs/work/activity");
  expect(before).toHaveLength(1);
  const seededId = before[0]!.id;

  const prs: PRFixture[] = [
    {
      id: "PR_RECOVERY",
      number: 1,
      title: "Old",
      url: "https://github.com/acme/thing/pull/1",
      state: "MERGED",
      isDraft: false,
      createdAt: "2026-04-20T10:00:00Z",
      updatedAt: "2026-04-23T14:00:00Z",
      mergedAt: "2026-04-23T14:00:00Z",
      closedAt: "2026-04-23T14:00:00Z",
      additions: 5,
      deletions: 1,
      baseRefName: "main",
      repository: REPO,
    },
  ];
  const { syncConnection } = await import("../src/core/github/sync.ts");
  const r = await syncConnection(cid, makeStubClient(prs));
  // No DB row for this event yet — but marker recovery means we adopt the
  // pre-seeded entry's id rather than creating a duplicate.
  expect(r.updated).toBe(1);
  expect(r.written).toBe(0);

  const after = await listEntries("logs/work/activity");
  expect(after).toHaveLength(1);
  expect(after[0]!.id).toBe(seededId);
  expect(after[0]!.content).toContain("**Merged PR**");
});
