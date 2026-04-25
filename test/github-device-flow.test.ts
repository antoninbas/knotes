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
  await rm(testHome, { recursive: true, force: true });
  delete process.env["KNOTES_HOME"];
});

test("startDeviceFlow posts the supplied client_id and scope to /login/device/code", async () => {
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    return new Response(
      JSON.stringify({
        device_code: "DEV123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as any;

  const { startDeviceFlow } = await import("../src/core/github/auth.ts");
  const info = await startDeviceFlow("github.com", { clientId: "Iv1.testapp" });
  expect(info.user_code).toBe("ABCD-1234");
  expect(info.device_code).toBe("DEV123");
  expect(info.host).toBe("github.com");
  expect(info.clientId).toBe("Iv1.testapp");

  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("https://github.com/login/device/code");
  expect(calls[0]!.body.client_id).toBe("Iv1.testapp");
  expect(calls[0]!.body.scope).toContain("repo");
});

test("startDeviceFlow throws a helpful error when no client_id is provided and no built-in is registered", async () => {
  globalThis.fetch = vi.fn(async () => new Response("should not be called", { status: 500 })) as any;
  const { startDeviceFlow } = await import("../src/core/github/auth.ts");
  await expect(startDeviceFlow("github.com")).rejects.toThrow(/requires an OAuth App client_id/);
  await expect(startDeviceFlow("ghe.example.com")).rejects.toThrow(
    /https:\/\/ghe\.example\.com\/settings\/applications\/new/
  );
});

test("startDeviceFlow uses GHES URLs for self-hosted hosts", async () => {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    return new Response(
      JSON.stringify({
        device_code: "D",
        user_code: "U",
        verification_uri: "https://ghe.example.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as any;
  const { startDeviceFlow } = await import("../src/core/github/auth.ts");
  await startDeviceFlow("ghe.example.com", { clientId: "Iv1.ghes" });
  expect(calls[0]).toBe("https://ghe.example.com/login/device/code");
});

test("startDeviceFlow surfaces a helpful error when device flow is unavailable", async () => {
  globalThis.fetch = vi.fn(
    async () => new Response("disabled", { status: 404 })
  ) as any;
  const { startDeviceFlow } = await import("../src/core/github/auth.ts");
  await expect(
    startDeviceFlow("ghe.example.com", { clientId: "Iv1.ghes" })
  ).rejects.toThrow(/Device flow not available/i);
});

test("pollDeviceToken returns pending when GitHub returns authorization_pending", async () => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ error: "authorization_pending" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  ) as any;
  const { pollDeviceToken } = await import("../src/core/github/auth.ts");
  const r = await pollDeviceToken("github.com", "DEV", 5, { clientId: "Iv1.testapp" });
  expect(r.status).toBe("pending");
});

test("loginDevice persists the client_id on the account row (multi-account, different client_ids)", async () => {
  // Simulate two device-flow logins on github.com, each with its own
  // OAuth App client_id (e.g. user's personal app vs. an org app), and
  // approving as two distinct GitHub identities.
  let userIdx = 0;
  const fixtures = [
    { clientId: "Iv1.alice_app", login: "alice", nodeId: "U_A" },
    { clientId: "Iv1.bob_app", login: "bob", nodeId: "U_B" },
  ];

  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    const fixture = fixtures[userIdx]!;
    if (url.endsWith("/login/device/code")) {
      return new Response(
        JSON.stringify({
          device_code: "DEV",
          user_code: "U-CODE",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.endsWith("/login/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: `tok_${fixture.login}`, scope: "repo" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/user")) {
      return new Response(JSON.stringify({ login: fixture.login, node_id: fixture.nodeId }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as any;

  const { loginDevice } = await import("../src/core/github/auth.ts");
  const { listAccounts } = await import("../src/core/github/db.ts");

  userIdx = 0;
  const acct1 = await loginDevice("github.com", { clientId: fixtures[0]!.clientId });
  expect(acct1.login).toBe("alice");
  expect(acct1.clientId).toBe("Iv1.alice_app");
  expect(acct1.authMethod).toBe("device");

  userIdx = 1;
  const acct2 = await loginDevice("github.com", { clientId: fixtures[1]!.clientId });
  expect(acct2.login).toBe("bob");
  expect(acct2.clientId).toBe("Iv1.bob_app");

  const accounts = listAccounts();
  expect(accounts).toHaveLength(2);
  const byLogin = Object.fromEntries(accounts.map((a) => [a.login, a]));
  expect(byLogin["alice"]!.clientId).toBe("Iv1.alice_app");
  expect(byLogin["bob"]!.clientId).toBe("Iv1.bob_app");
});

test("pollDeviceToken returns ok with the access token on success", async () => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ access_token: "ghu_abc", scope: "repo" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  ) as any;
  const { pollDeviceToken } = await import("../src/core/github/auth.ts");
  const r = await pollDeviceToken("github.com", "DEV", 5, { clientId: "Iv1.testapp" });
  expect(r.status).toBe("ok");
  expect(r.token).toBe("ghu_abc");
  expect(r.scope).toBe("repo");
});
