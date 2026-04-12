import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Set KNOTES_HOME before importing config to avoid affecting real data
let testHome: string;

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "knotes-test-"));
  process.env["KNOTES_HOME"] = testHome;
  // Reset cached config
  const { resetConfigCache } = await import("../src/core/config.ts");
  resetConfigCache();
});

afterEach(async () => {
  await rm(testHome, { recursive: true, force: true });
  delete process.env["KNOTES_HOME"];
});

test("getHome returns KNOTES_HOME env", async () => {
  const { getHome } = await import("../src/core/config.ts");
  expect(getHome()).toBe(testHome);
});

test("getConfig returns defaults", async () => {
  const { getConfig } = await import("../src/core/config.ts");
  const config = getConfig();
  expect(config.home).toBe(testHome);
  expect(config.editor).toBe(process.env["EDITOR"] || "vi");
  expect(config.webPort).toBe(7713);
  expect(config.theme).toBe("system");
});

test("ensureHome creates directory structure", async () => {
  const { ensureHome } = await import("../src/core/config.ts");
  await ensureHome();
  expect(await Bun.file(join(testHome, ".config")).exists()).toBe(false); // it's a dir
  expect(await Bun.file(join(testHome, "notes", ".keep")).exists()).toBe(false); // no .keep by default
  // Check dirs exist by trying to write to them
  await Bun.write(join(testHome, ".config", "test"), "ok");
  await Bun.write(join(testHome, ".data", "test"), "ok");
  await Bun.write(join(testHome, "notes", "test"), "ok");
  await Bun.write(join(testHome, "logs", "test"), "ok");
});

test("resolvePath and toLogicalPath are inverses", async () => {
  const { resolvePath, toLogicalPath } = await import("../src/core/config.ts");
  const logical = "notes/projects/foo";
  const absolute = resolvePath(logical);
  expect(absolute).toBe(join(testHome, "notes/projects/foo.md"));
  expect(toLogicalPath(absolute)).toBe(logical);
});

test("resolvePath strips .md extension if already present", async () => {
  const { resolvePath } = await import("../src/core/config.ts");
  expect(resolvePath("notes/foo.md")).toBe(join(testHome, "notes/foo.md"));
  expect(resolvePath("notes/foo")).toBe(join(testHome, "notes/foo.md"));
});

test("saveConfig persists and reloads", async () => {
  const { ensureHome, saveConfig, getConfig, resetConfigCache } = await import("../src/core/config.ts");
  await ensureHome();
  await saveConfig({ webPort: 8080, theme: "dark" });
  resetConfigCache();
  const config = getConfig();
  expect(config.webPort).toBe(8080);
  expect(config.theme).toBe("dark");
});
