import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { __test__ } from "../src/core/github/sync.ts";
import type { GhClient } from "../src/core/github/api.ts";

const { renderPR, renderIssue } = __test__;

const REPO = {
  name: "thing",
  nameWithOwner: "acme/thing",
  owner: { login: "acme" },
};

function makePR(body: string | null) {
  return {
    id: "PR_BODY",
    number: 50,
    title: "Title",
    body,
    url: "https://github.com/acme/thing/pull/50",
    state: "OPEN" as const,
    isDraft: false,
    createdAt: "2026-04-22T08:00:00Z",
    updatedAt: "2026-04-22T08:00:00Z",
    mergedAt: null,
    closedAt: null,
    additions: 1,
    deletions: 0,
    baseRefName: "main",
    repository: REPO,
  };
}

function makeIssue(body: string | null) {
  return {
    id: "ISS_BODY",
    number: 90,
    title: "Issue",
    body,
    url: "https://github.com/acme/thing/issues/90",
    state: "OPEN" as const,
    createdAt: "2026-04-22T08:00:00Z",
    updatedAt: "2026-04-22T08:00:00Z",
    closedAt: null,
    labels: { nodes: [] },
    repository: REPO,
  };
}

test("bodyMode=title (default) emits no body block", () => {
  const r = renderPR(makePR("Some details about the PR"));
  // No markdown blockquote line (`> `) — the `>` from the closing `-->` of
  // the gh-event marker doesn't count.
  expect(r.content).not.toMatch(/^> /m);
  expect(r.content).toMatch(/State: OPEN.*\n\n<!-- gh-event/);
});

test("bodyMode=full quotes the entire body", () => {
  const body = "First paragraph here.\n\nSecond paragraph with **bold**.";
  const r = renderPR(makePR(body), "full");
  expect(r.content).toContain("> First paragraph here.");
  expect(r.content).toContain("> Second paragraph with **bold**.");
  expect(r.content).not.toContain("> …");
});

test("bodyMode=first_paragraph stops at the first blank line", () => {
  const body = "Just the first paragraph.\n\nSecond paragraph (should NOT appear).";
  const r = renderPR(makePR(body), "first_paragraph");
  expect(r.content).toContain("> Just the first paragraph.");
  expect(r.content).not.toContain("Second paragraph");
  expect(r.content).toContain("> …"); // truncation marker
});

test("bodyMode=first_paragraph without a blank line emits the whole body", () => {
  const body = "Single paragraph without a blank line.";
  const r = renderPR(makePR(body), "first_paragraph");
  expect(r.content).toContain("> Single paragraph without a blank line.");
  expect(r.content).not.toContain("> …");
});

test("bodyMode=first_chars truncates and appends an ellipsis", () => {
  const body = "0123456789ABCDEFGHIJ";
  const r = renderPR(makePR(body), "first_chars", 10);
  expect(r.content).toContain("> 0123456789");
  expect(r.content).toContain("> …");
});

test("bodyMode=first_chars with maxChars >= body length emits without truncation", () => {
  const body = "short body";
  const r = renderPR(makePR(body), "first_chars", 200);
  expect(r.content).toContain("> short body");
  expect(r.content).not.toContain("> …");
});

test("formatBody handles empty / null bodies gracefully", () => {
  const r1 = renderPR(makePR(null), "full");
  const r2 = renderPR(makePR(""), "full");
  const r3 = renderPR(makePR("   \n  \n"), "full");
  for (const r of [r1, r2, r3]) {
    expect(r.content).not.toMatch(/^> /m);
  }
});

test("renderIssue honors bodyMode in the same way", () => {
  const r = renderIssue(makeIssue("First.\n\nSecond."), "first_paragraph");
  expect(r.content).toContain("> First.");
  expect(r.content).not.toContain("> Second");
});

// --- End-to-end through sync ---

let testHome: string;

function makeStubClient(prs: any[], issues: any[] = []): GhClient {
  return {
    async graphql(query: string) {
      if (query.includes("SearchPRs")) {
        return {
          search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: prs },
        } as any;
      }
      if (query.includes("SearchIssues")) {
        return {
          search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: issues },
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

async function setupConn(
  bodyMode: "title" | "full" | "first_paragraph" | "first_chars" = "title",
  bodyMaxChars: number | null = null
): Promise<number> {
  const { insertAccount } = await import("../src/core/github/db.ts");
  insertAccount({
    host: "github.com",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "pat",
    token: "t",
  });
  const { createLog } = await import("../src/core/logs.ts");
  await createLog("logs/work/activity", "Activity");
  const { addConnection } = await import("../src/core/github/connections.ts");
  const conn = await addConnection({
    logPath: "logs/work/activity",
    host: "github.com",
    login: "alice",
    monitors: ["opened_prs", "merged_prs"],
    since: "2026-04-01T00:00:00Z",
    bodyMode,
    bodyMaxChars,
  });
  return conn.id;
}

test("connection respects bodyMode=full when syncing", async () => {
  const cid = await setupConn("full");
  const client = makeStubClient([makePR("Body line 1\n\nBody line 2")]);
  const { syncConnection } = await import("../src/core/github/sync.ts");
  await syncConnection(cid, client);
  const { listEntries } = await import("../src/core/logs.ts");
  const entries = await listEntries("logs/work/activity");
  expect(entries[0]!.content).toContain("> Body line 1");
  expect(entries[0]!.content).toContain("> Body line 2");
});

test("editing the PR body on GitHub triggers an entry rewrite", async () => {
  const cid = await setupConn("full");
  const v1 = makePR("Initial body content");
  const v2 = { ...v1, body: "Edited body content with more detail" };

  const { syncConnection } = await import("../src/core/github/sync.ts");
  const { listEntries } = await import("../src/core/logs.ts");

  const r1 = await syncConnection(cid, makeStubClient([v1]));
  expect(r1.written).toBe(1);
  let entries = await listEntries("logs/work/activity");
  const firstId = entries[0]!.id;
  expect(entries[0]!.content).toContain("> Initial body content");

  const r2 = await syncConnection(cid, makeStubClient([v2]));
  expect(r2.updated).toBe(1);
  expect(r2.written).toBe(0);

  entries = await listEntries("logs/work/activity");
  expect(entries).toHaveLength(1);
  expect(entries[0]!.id).toBe(firstId);
  expect(entries[0]!.content).toContain("> Edited body content with more detail");
  expect(entries[0]!.content).not.toContain("Initial body content");
});

test("changing bodyMode on the connection rewrites existing entries on next sync", async () => {
  const cid = await setupConn("title");
  const pr = makePR("Long body that will be revealed later");

  const { syncConnection } = await import("../src/core/github/sync.ts");
  const { listEntries } = await import("../src/core/logs.ts");
  const { updateConnection } = await import("../src/core/github/connections.ts");

  await syncConnection(cid, makeStubClient([pr]));
  let entries = await listEntries("logs/work/activity");
  expect(entries[0]!.content).not.toMatch(/^> /m);

  await updateConnection(cid, { bodyMode: "full" });
  const r2 = await syncConnection(cid, makeStubClient([pr]));
  expect(r2.updated).toBe(1);

  entries = await listEntries("logs/work/activity");
  expect(entries[0]!.content).toContain("> Long body that will be revealed later");
});

test("title-only connections do NOT request `body` over GraphQL", async () => {
  const cid = await setupConn("title");
  const queries: string[] = [];
  const client: GhClient = {
    async graphql(query: string) {
      queries.push(query);
      return {
        search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
      } as any;
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
  const { syncConnection } = await import("../src/core/github/sync.ts");
  await syncConnection(cid, client);
  expect(queries.length).toBeGreaterThan(0);
  for (const q of queries) {
    expect(q).not.toMatch(/^\s*body\s*$/m);
  }
});

test("non-title connections DO request `body` over GraphQL", async () => {
  const cid = await setupConn("first_paragraph");
  const queries: string[] = [];
  const client: GhClient = {
    async graphql(query: string) {
      queries.push(query);
      return {
        search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
      } as any;
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
  const { syncConnection } = await import("../src/core/github/sync.ts");
  await syncConnection(cid, client);
  // The PR query (only one issued for opened_prs+merged_prs monitors) must
  // include `body` as its own line.
  const prQuery = queries.find((q) => q.includes("SearchPRs"))!;
  expect(prQuery).toMatch(/^\s*body\s*$/m);
});

test("addConnection rejects bodyMode=first_chars without bodyMaxChars", async () => {
  const { insertAccount } = await import("../src/core/github/db.ts");
  insertAccount({
    host: "github.com",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "pat",
    token: "t",
  });
  const { createLog } = await import("../src/core/logs.ts");
  await createLog("logs/work/activity", "Activity");
  const { addConnection } = await import("../src/core/github/connections.ts");
  await expect(
    addConnection({
      logPath: "logs/work/activity",
      host: "github.com",
      login: "alice",
      monitors: ["opened_prs"],
      bodyMode: "first_chars",
    })
  ).rejects.toThrow(/bodyMaxChars/);
});
