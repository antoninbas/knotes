import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const ROOT_DIR = join(import.meta.dir, "..");
let testHome: string;

async function run(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", "src/main.ts", ...args], {
    cwd: ROOT_DIR,
    env: { ...process.env, KNOTES_HOME: testHome },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "knotes-cli-test-"));
  process.env["KNOTES_HOME"] = testHome;
  const { resetConfigCache, ensureHome, saveConfig } = await import("../src/core/config.ts");
  resetConfigCache();
  const { resetStore } = await import("../src/core/search.ts");
  resetStore();
  await ensureHome();
  // Enable serverless mode so CLI doesn't need a running server
  await saveConfig({ serverless: true });
});

afterEach(async () => {
  await rm(testHome, { recursive: true, force: true });
  delete process.env["KNOTES_HOME"];
});

// ─── Note commands ───────────────────────────────────────────────

test("note create creates a note", async () => {
  const { code, stdout } = await run("note", "create", "notes/hello", "--title", "Hello World");
  expect(code).toBe(0);
  expect(stdout).toContain("Created");
  expect(stdout).toContain("notes/hello");
});

test("note show displays content", async () => {
  await run("note", "create", "notes/show-me", "--title", "Show Me");
  const { code, stdout } = await run("note", "show", "notes/show-me");
  expect(code).toBe(0);
  expect(stdout).toContain("Show Me");
});

test("note show fails for nonexistent note", async () => {
  const { code, stderr } = await run("note", "show", "notes/nope");
  expect(code).not.toBe(0);
});

test("note list shows notes", async () => {
  await run("note", "create", "notes/a", "--title", "Note A");
  await run("note", "create", "notes/b", "--title", "Note B");
  const { code, stdout } = await run("note", "list", "notes");
  expect(code).toBe(0);
  expect(stdout).toContain("notes/a");
  expect(stdout).toContain("notes/b");
});

test("note mkdir creates a folder", async () => {
  const { code, stdout } = await run("note", "mkdir", "notes/subdir");
  expect(code).toBe(0);
  expect(stdout).toContain("Created folder");
});

test("note delete removes a note", async () => {
  await run("note", "create", "notes/del-me");
  const { code, stdout } = await run("note", "delete", "notes/del-me");
  expect(code).toBe(0);
  expect(stdout).toContain("Deleted");

  // Verify it's gone
  const show = await run("note", "show", "notes/del-me");
  expect(show.code).not.toBe(0);
});

test("note create with tags", async () => {
  const { code } = await run("note", "create", "notes/tagged", "--title", "Tagged", "--tags", "a,b,c");
  expect(code).toBe(0);

  const { stdout } = await run("note", "show", "notes/tagged");
  expect(stdout).toContain("Tagged");
});

// ─── Log commands ────────────────────────────────────────────────

test("log create creates a log", async () => {
  const { code, stdout } = await run("log", "create", "logs/daily", "--title", "Daily");
  expect(code).toBe(0);
  expect(stdout).toContain("Created log");
});

test("log add adds an entry", async () => {
  await run("log", "create", "logs/test");
  const { code, stdout } = await run("log", "add", "logs/test", "-m", "First entry");
  expect(code).toBe(0);
  expect(stdout).toContain("Added entry");
  expect(stdout).toMatch(/e-[a-f0-9]{4}/);
});

test("log list shows entries", async () => {
  await run("log", "create", "logs/list");
  await run("log", "add", "logs/list", "-m", "Entry one");
  await run("log", "add", "logs/list", "-m", "Entry two");

  const { code, stdout } = await run("log", "list", "logs/list");
  expect(code).toBe(0);
  expect(stdout).toContain("Entry one");
  expect(stdout).toContain("Entry two");
});

test("log list respects limit", async () => {
  await run("log", "create", "logs/lim");
  await run("log", "add", "logs/lim", "-m", "One");
  await run("log", "add", "logs/lim", "-m", "Two");
  await run("log", "add", "logs/lim", "-m", "Three");

  const { code, stdout } = await run("log", "list", "logs/lim", "--limit", "1");
  expect(code).toBe(0);
  expect(stdout).toContain("Three");
  expect(stdout).not.toContain("One");
});

// ─── Config commands ─────────────────────────────────────────────

test("config show displays config", async () => {
  const { code, stdout } = await run("config", "show");
  expect(code).toBe(0);
  expect(stdout).toContain("webPort");
});

test("config show --json outputs JSON", async () => {
  const { code, stdout } = await run("config", "show", "--json");
  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.webPort).toBe(7713);
});

test("config get returns a value", async () => {
  const { code, stdout } = await run("config", "get", "webPort");
  expect(code).toBe(0);
  expect(stdout.trim()).toBe("7713");
});

test("config set updates a value", async () => {
  const set = await run("config", "set", "webPort", "8080");
  expect(set.code).toBe(0);

  const get = await run("config", "get", "webPort");
  expect(get.stdout.trim()).toBe("8080");
});

test("config set rejects invalid key", async () => {
  const { code, stderr } = await run("config", "set", "invalid", "value");
  expect(code).not.toBe(0);
});

// ─── Search commands ─────────────────────────────────────────────

test("search returns results or empty", async () => {
  await run("note", "create", "notes/find-me", "--title", "Findable Note");
  const result = await run("search", "findable", "--mode", "bm25");
  expect(result.code).toBe(0);
}, 60_000);

test("index command runs successfully", async () => {
  const { code, stdout } = await run("index");
  expect(code).toBe(0);
  expect(stdout).toContain("Index updated");
}, 60_000);

// ─── Help ────────────────────────────────────────────────────────

test("--help shows usage", async () => {
  const { code, stdout } = await run("--help");
  expect(code).toBe(0);
  expect(stdout).toContain("knotes");
  expect(stdout).toContain("note");
  expect(stdout).toContain("log");
  expect(stdout).toContain("search");
});

test("note --help shows subcommands", async () => {
  const { code, stdout } = await run("note", "--help");
  expect(code).toBe(0);
  expect(stdout).toContain("create");
  expect(stdout).toContain("edit");
  expect(stdout).toContain("show");
  expect(stdout).toContain("delete");
  expect(stdout).toContain("list");
});
