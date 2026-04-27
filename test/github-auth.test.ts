import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let testHome: string;
let originalFetch: typeof fetch;

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "knotes-test-"));
  process.env["KNOTES_HOME"] = testHome;
  const { resetConfigCache } = await import("../src/core/config.ts");
  resetConfigCache();
  const { resetDb } = await import("../src/core/db.ts");
  resetDb();
  const { ensureHome } = await import("../src/core/config.ts");
  await ensureHome();
  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  const { resetDb } = await import("../src/core/db.ts");
  resetDb();
  const { resetVaultCache } = await import("../src/core/vault.ts");
  resetVaultCache();
  await rm(testHome, { recursive: true, force: true });
  delete process.env["KNOTES_HOME"];
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    return handler(url, init);
  }) as any;
}

test("loginPat fetches /user, stores account, getAuthHeader returns token", async () => {
  stubFetch((url) => {
    if (url.endsWith("/user")) {
      return new Response(
        JSON.stringify({ login: "alice", node_id: "U_1" }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-oauth-scopes": "repo, read:user",
          },
        }
      );
    }
    return new Response("not found", { status: 404 });
  });

  const { loginPat, getAuthHeader } = await import("../src/core/github/auth.ts");
  const acct = await loginPat("github.com", "ghp_test123");
  expect(acct.login).toBe("alice");
  expect(acct.host).toBe("github.com");
  expect(acct.authMethod).toBe("pat");
  expect(acct.tokenScopes).toBe("repo, read:user");

  const header = await getAuthHeader(acct.id);
  expect(header).toBe("token ghp_test123");
});

test("loginPat normalizes the host (strips https:// and trailing slashes)", async () => {
  stubFetch(() =>
    new Response(JSON.stringify({ login: "bob", node_id: "U_2" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
  const { loginPat } = await import("../src/core/github/auth.ts");
  const acct = await loginPat("https://Ghe.Example.Com/", "tok");
  expect(acct.host).toBe("ghe.example.com");
});

test("loginPat surfaces 401 from /user", async () => {
  stubFetch(() =>
    new Response(JSON.stringify({ message: "Bad credentials" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })
  );
  const { loginPat } = await import("../src/core/github/auth.ts");
  await expect(loginPat("github.com", "bogus")).rejects.toThrow(/401/);
});

test("logout removes the account", async () => {
  stubFetch(() =>
    new Response(JSON.stringify({ login: "alice", node_id: "U_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
  const { loginPat } = await import("../src/core/github/auth.ts");
  const { logout } = await import("../src/core/github/auth.ts");
  const { listAccounts } = await import("../src/core/github/db.ts");

  await loginPat("github.com", "tok");
  expect(listAccounts()).toHaveLength(1);
  await logout("github.com", "alice");
  expect(listAccounts()).toHaveLength(0);
});

test("getAuthHeader for gh-cli account fails when gh is not authenticated", async () => {
  // Insert a gh-cli account directly; getAuthHeader will try to shell out.
  const { insertAccount } = await import("../src/core/github/db.ts");
  const id = insertAccount({
    host: "ghe.test.invalid",
    login: "alice",
    userNodeId: "U_1",
    authMethod: "gh-cli",
  });

  const { getAuthHeader } = await import("../src/core/github/auth.ts");
  // Either gh isn't installed (spawnSync returns non-zero), or it has no token
  // for this fake host. Either way, getAuthHeader must throw a helpful message.
  await expect(getAuthHeader(id)).rejects.toThrow(/gh CLI/);
});
