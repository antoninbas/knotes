import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
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

const REPO = {
  name: "thing",
  nameWithOwner: "acme/thing",
  owner: { login: "acme" },
};

interface Fixtures {
  prs?: any[];
  issues?: any[];
  reviewed?: any[];
}

function makeStubClient(f: Fixtures): GhClient {
  return {
    async graphql(query: string) {
      if (query.includes("SearchPRs")) {
        return {
          search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: f.prs ?? [] },
        } as any;
      }
      if (query.includes("SearchIssues")) {
        return {
          search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: f.issues ?? [] },
        } as any;
      }
      if (query.includes("SearchReviewedPRs")) {
        return {
          search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: f.reviewed ?? [] },
        } as any;
      }
      return { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } as any;
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

async function setupConnection(monitors: string[], since = "2026-04-01T00:00:00Z"): Promise<number> {
  const { insertAccount } = await import("../src/core/github/db.ts");
  insertAccount({
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
    since,
  });
  return conn.id;
}

test("syncConnection writes opened-issue entries", async () => {
  const cid = await setupConnection(["opened_issues"]);
  const client = makeStubClient({
    issues: [
      {
        id: "ISS_1",
        number: 11,
        title: "Crash on startup",
        url: "https://github.com/acme/thing/issues/11",
        state: "OPEN",
        createdAt: "2026-04-22T08:30:00Z",
        updatedAt: "2026-04-22T08:30:00Z",
        closedAt: null,
        labels: { nodes: [{ name: "bug" }] },
        repository: REPO,
      },
    ],
  });
  const { syncConnection } = await import("../src/core/github/sync.ts");
  const r = await syncConnection(cid, client);
  expect(r.written).toBe(1);

  const { listEntries } = await import("../src/core/logs.ts");
  const entries = await listEntries("logs/work/activity");
  expect(entries).toHaveLength(1);
  expect(entries[0]!.content).toContain("**Opened issue**");
  expect(entries[0]!.content).toContain("acme/thing#11");
  expect(entries[0]!.content).toContain("Labels: bug");
  expect(entries[0]!.timestamp).toBe("2026-04-22T08:30:00Z");
});

test("syncConnection updates issue entry when state moves OPEN → CLOSED", async () => {
  const cid = await setupConnection(["opened_issues"]);
  const opened = {
    id: "ISS_2",
    number: 22,
    title: "Bug",
    url: "https://github.com/acme/thing/issues/22",
    state: "OPEN",
    createdAt: "2026-04-15T08:00:00Z",
    updatedAt: "2026-04-15T08:00:00Z",
    closedAt: null,
    labels: { nodes: [] },
    repository: REPO,
  };
  const closed = {
    ...opened,
    state: "CLOSED",
    closedAt: "2026-04-23T11:00:00Z",
    updatedAt: "2026-04-23T11:00:00Z",
  };

  const { syncConnection } = await import("../src/core/github/sync.ts");
  await syncConnection(cid, makeStubClient({ issues: [opened] }));
  const { listEntries } = await import("../src/core/logs.ts");
  let entries = await listEntries("logs/work/activity");
  const firstId = entries[0]!.id;
  expect(entries[0]!.content).toContain("**Opened issue**");

  const r = await syncConnection(cid, makeStubClient({ issues: [closed] }));
  expect(r.updated).toBe(1);
  entries = await listEntries("logs/work/activity");
  expect(entries).toHaveLength(1);
  expect(entries[0]!.id).toBe(firstId);
  expect(entries[0]!.content).toContain("**Closed issue**");
  expect(entries[0]!.timestamp).toBe("2026-04-23T11:00:00Z");
});

test("syncConnection writes one combined entry for multiple reviews on one PR", async () => {
  const cid = await setupConnection(["pr_reviews"]);
  const client = makeStubClient({
    reviewed: [
      {
        id: "PR_7",
        number: 7,
        title: "Refactor",
        url: "https://github.com/acme/thing/pull/7",
        repository: REPO,
        reviews: {
          nodes: [
            {
              id: "REV_1",
              state: "COMMENTED",
              submittedAt: "2026-04-21T09:00:00Z",
              comments: { totalCount: 2 },
            },
            {
              id: "REV_2",
              state: "APPROVED",
              submittedAt: "2026-04-23T15:00:00Z",
              comments: { totalCount: 0 },
            },
          ],
        },
      },
    ],
  });
  const { syncConnection } = await import("../src/core/github/sync.ts");
  const r = await syncConnection(cid, client);
  expect(r.written).toBe(1);

  const { listEntries } = await import("../src/core/logs.ts");
  const entries = await listEntries("logs/work/activity");
  expect(entries).toHaveLength(1);
  // Both reviews in a single entry, newest first
  expect(entries[0]!.content).toContain("APPROVED");
  expect(entries[0]!.content).toContain("COMMENTED");
  expect(entries[0]!.content).toMatch(/APPROVED.*\n.*COMMENTED/s);
  expect(entries[0]!.timestamp).toBe("2026-04-23T15:00:00Z");
});

test("syncConnection includes all reviews for a PR when at least one is within the cutoff", async () => {
  // since = 2026-04-22 — PR has one old review and one new review.
  // The combined entry should include both, since the PR has a recent review.
  const cid = await setupConnection(["pr_reviews"], "2026-04-22T00:00:00Z");
  const client = makeStubClient({
    reviewed: [
      {
        id: "PR_7",
        number: 7,
        title: "Refactor",
        url: "https://github.com/acme/thing/pull/7",
        repository: REPO,
        reviews: {
          nodes: [
            {
              id: "REV_OLD",
              state: "COMMENTED",
              submittedAt: "2026-04-01T09:00:00Z",
              comments: { totalCount: 1 },
            },
            {
              id: "REV_NEW",
              state: "APPROVED",
              submittedAt: "2026-04-23T15:00:00Z",
              comments: { totalCount: 0 },
            },
          ],
        },
      },
    ],
  });
  const { syncConnection } = await import("../src/core/github/sync.ts");
  const r = await syncConnection(cid, client);
  expect(r.pulled).toBe(1);
  expect(r.written).toBe(1);

  const { listEntries } = await import("../src/core/logs.ts");
  const entries = await listEntries("logs/work/activity");
  expect(entries).toHaveLength(1);
  expect(entries[0]!.content).toContain("APPROVED");
  expect(entries[0]!.content).toContain("COMMENTED");
});

test("syncConnection processes PRs, issues, and reviews together when all monitors are enabled", async () => {
  const cid = await setupConnection([
    "opened_prs",
    "merged_prs",
    "opened_issues",
    "pr_reviews",
  ]);
  const client = makeStubClient({
    prs: [
      {
        id: "PR_1",
        number: 1,
        title: "PR",
        url: "https://github.com/acme/thing/pull/1",
        state: "MERGED",
        isDraft: false,
        createdAt: "2026-04-22T10:00:00Z",
        updatedAt: "2026-04-22T10:00:00Z",
        mergedAt: "2026-04-22T10:00:00Z",
        closedAt: "2026-04-22T10:00:00Z",
        additions: 10,
        deletions: 0,
        baseRefName: "main",
        repository: REPO,
      },
    ],
    issues: [
      {
        id: "ISS_1",
        number: 5,
        title: "Issue",
        url: "https://github.com/acme/thing/issues/5",
        state: "OPEN",
        createdAt: "2026-04-22T11:00:00Z",
        updatedAt: "2026-04-22T11:00:00Z",
        closedAt: null,
        labels: { nodes: [] },
        repository: REPO,
      },
    ],
    reviewed: [
      {
        id: "PR_9",
        number: 9,
        title: "Other",
        url: "https://github.com/acme/thing/pull/9",
        repository: REPO,
        reviews: {
          nodes: [
            {
              id: "REV_1",
              state: "APPROVED",
              submittedAt: "2026-04-22T12:00:00Z",
              comments: { totalCount: 0 },
            },
          ],
        },
      },
    ],
  });
  const { syncConnection } = await import("../src/core/github/sync.ts");
  const r = await syncConnection(cid, client);
  expect(r.pulled).toBe(3);
  expect(r.written).toBe(3);

  const { listEntries } = await import("../src/core/logs.ts");
  const entries = await listEntries("logs/work/activity");
  expect(entries).toHaveLength(3);
});
