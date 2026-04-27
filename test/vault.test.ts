import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { existsSync, statSync } from "node:fs";

let testHome: string;

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "knotes-test-"));
  process.env["KNOTES_HOME"] = testHome;
  process.env["KNOTES_VAULT_TEST_FAST"] = "1";
  const { resetConfigCache } = await import("../src/core/config.ts");
  resetConfigCache();
  const { ensureHome } = await import("../src/core/config.ts");
  await ensureHome();
});

afterEach(async () => {
  const { resetVaultCache } = await import("../src/core/vault.ts");
  resetVaultCache();
  await rm(testHome, { recursive: true, force: true });
  delete process.env["KNOTES_HOME"];
  delete process.env["KNOTES_VAULT_TEST_FAST"];
});

test("vault.json is created on first setToken", async () => {
  const { setToken } = await import("../src/core/vault.ts");
  setToken("github.com", "alice", "ghp_test");
  const vaultPath = join(testHome, ".data", "vault.json");
  expect(existsSync(vaultPath)).toBe(true);
});

test("vault.json has mode 0600", async () => {
  const { setToken } = await import("../src/core/vault.ts");
  setToken("github.com", "alice", "ghp_test");
  const vaultPath = join(testHome, ".data", "vault.json");
  if (process.platform !== "win32") {
    const mode = statSync(vaultPath).mode & 0o777;
    expect(mode).toBe(0o600);
  }
});

test("getToken returns the stored token", async () => {
  const { setToken, getToken } = await import("../src/core/vault.ts");
  setToken("github.com", "alice", "secret-token");
  expect(getToken("github.com", "alice")).toBe("secret-token");
});

test("getToken returns null for missing token", async () => {
  const { getToken } = await import("../src/core/vault.ts");
  expect(getToken("github.com", "bob")).toBeNull();
});

test("deleteToken removes the token", async () => {
  const { setToken, getToken, deleteToken } = await import("../src/core/vault.ts");
  setToken("github.com", "alice", "secret");
  deleteToken("github.com", "alice");
  expect(getToken("github.com", "alice")).toBeNull();
});

test("encrypt then decrypt round-trip", async () => {
  const { setToken, getToken, setupEncryption, disableEncryption, isEncrypted, isLocked } = await import("../src/core/vault.ts");
  setToken("github.com", "alice", "secret");
  setupEncryption("passphrase");
  expect(isEncrypted()).toBe(true);
  expect(isLocked()).toBe(false);

  // Lock and unlock
  const { lock, unlock } = await import("../src/core/vault.ts");
  lock();
  expect(isLocked()).toBe(true);
  expect(() => getToken("github.com", "alice")).toThrow(/locked/);

  unlock("passphrase");
  expect(isLocked()).toBe(false);
  expect(getToken("github.com", "alice")).toBe("secret");

  disableEncryption("passphrase");
  expect(isEncrypted()).toBe(false);
  expect(getToken("github.com", "alice")).toBe("secret");
});

test("wrong passphrase is rejected", async () => {
  const { setToken, setupEncryption, unlock } = await import("../src/core/vault.ts");
  setToken("github.com", "alice", "secret");
  setupEncryption("correct");
  expect(() => unlock("wrong")).toThrow(/Invalid passphrase/);
});

test("listTokens returns all entries", async () => {
  const { setToken, listTokens } = await import("../src/core/vault.ts");
  setToken("github.com", "alice", "a");
  setToken("ghe.example.com", "bob", "b");
  const tokens = listTokens();
  expect(tokens).toHaveLength(2);
  expect(tokens).toContainEqual({ host: "github.com", login: "alice" });
  expect(tokens).toContainEqual({ host: "ghe.example.com", login: "bob" });
});

test(".data/.gitignore is auto-created", async () => {
  const { setToken } = await import("../src/core/vault.ts");
  setToken("github.com", "alice", "ghp_test");
  const gitignorePath = join(testHome, ".data", ".gitignore");
  expect(existsSync(gitignorePath)).toBe(true);
});
