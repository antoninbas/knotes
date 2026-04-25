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

test("startDeviceFlow posts to /login/device/code with the configured client_id and scope", async () => {
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
  const info = await startDeviceFlow("github.com");
  expect(info.user_code).toBe("ABCD-1234");
  expect(info.device_code).toBe("DEV123");
  expect(info.host).toBe("github.com");

  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("https://github.com/login/device/code");
  expect(calls[0]!.body.client_id).toBeTruthy();
  expect(calls[0]!.body.scope).toContain("repo");
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
  await startDeviceFlow("ghe.example.com");
  expect(calls[0]).toBe("https://ghe.example.com/login/device/code");
});

test("startDeviceFlow surfaces a helpful error when device flow is unavailable", async () => {
  globalThis.fetch = vi.fn(
    async () => new Response("disabled", { status: 404 })
  ) as any;
  const { startDeviceFlow } = await import("../src/core/github/auth.ts");
  await expect(startDeviceFlow("ghe.example.com")).rejects.toThrow(
    /Device flow not available/i
  );
});

test("pollDeviceToken returns pending when GitHub returns authorization_pending", async () => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ error: "authorization_pending" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  ) as any;
  const { pollDeviceToken } = await import("../src/core/github/auth.ts");
  const r = await pollDeviceToken("github.com", "DEV", 5);
  expect(r.status).toBe("pending");
});

test("pollDeviceToken returns ok with the access token on success", async () => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ access_token: "ghu_abc", scope: "repo" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  ) as any;
  const { pollDeviceToken } = await import("../src/core/github/auth.ts");
  const r = await pollDeviceToken("github.com", "DEV", 5);
  expect(r.status).toBe("ok");
  expect(r.token).toBe("ghu_abc");
  expect(r.scope).toBe("repo");
});
