import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { RateLimitError, createClient } from "../src/core/github/api.ts";
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

function makeLowCostClient(remaining: number, resetAt: string | null): GhClient {
  const repo = { name: "thing", nameWithOwner: "acme/thing", owner: { login: "acme" } };
  return {
    async graphql(query: string) {
      return {
        search: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: "PR_1",
              number: 1,
              title: "Test",
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
              repository: repo,
            },
          ],
        },
      } as any;
    },
    async rest() {
      throw new Error("not used");
    },
    rateLimitInfo() {
      return { remaining: 5000, resetAt: null, graphQLCost: 1, graphQLRemaining: remaining, graphQLResetAt: resetAt };
    },
    async resolveViewer() {
      return { login: "alice", nodeId: "U_1", scopes: null };
    },
  };
}

test("createClient extracts rateLimit from GraphQL response and strips it from returned data", async () => {
  const responseBody = {
    data: {
      rateLimit: { cost: 2, remaining: 4800, resetAt: "2026-04-28T00:00:00Z" },
      search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
    },
  };
  const mockFetch: typeof fetch = async () =>
    new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const client = createClient({ authHeader: "token test_token", host: "github.com", fetchImpl: mockFetch });
  const data = await client.graphql("query { rateLimit { cost remaining resetAt } search { pageInfo { hasNextPage endCursor } nodes } }") as Record<string, unknown>;
  expect(data.rateLimit).toBeUndefined();
  expect(data.search).toBeDefined();
  const rl = client.rateLimitInfo();
  expect(rl.graphQLCost).toBe(2);
  expect(rl.graphQLRemaining).toBe(4800);
  expect(rl.graphQLResetAt).toBe("2026-04-28T00:00:00Z");
});

test("syncConnection returns rateLimited=true when GraphQL points are below 500", async () => {
  const cid = await setupAccountAndConnection();
  const { syncConnection } = await import("../src/core/github/sync.ts");
  const client = makeLowCostClient(400, "2026-04-23T00:00:00Z");
  const r = await syncConnection(cid, client);
  expect(r.rateLimited).toBe(true);
  expect(r.nextRetryAt).toBe("2026-04-23T00:00:00Z");
});

test("syncConnection proceeds normally when GraphQL points are above 500", async () => {
  const cid = await setupAccountAndConnection();
  const { syncConnection } = await import("../src/core/github/sync.ts");
  const client = makeLowCostClient(600, null);
  const r = await syncConnection(cid, client);
  expect(r.written).toBe(1);
});
