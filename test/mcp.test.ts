import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let testHome: string;
let client: Client;
let server: McpServer;

/**
 * Helper to call an MCP tool and return the text content of the first content item.
 */
async function callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0]?.text ?? "";
}

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "knotes-mcp-test-"));
  process.env["KNOTES_HOME"] = testHome;

  const { resetConfigCache, ensureHome } = await import("../src/core/config.ts");
  resetConfigCache();
  const { resetDb, setConfigValue } = await import("../src/core/db.ts");
  resetDb();
  const { resetStore } = await import("../src/core/search.ts");
  resetStore();
  await ensureHome();

  // Use serverless mode so the router calls core modules directly (no HTTP server needed)
  setConfigValue("serverless", "true");

  // Build an in-process MCP server with tools registered
  const { registerTools } = await import("../src/mcp/tools.ts");
  server = new McpServer({ name: "knotes-test", version: "0.0.0" });
  registerTools(server);

  // Wire server and client together via in-memory transport
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  await server.close();
  const { resetDb } = await import("../src/core/db.ts");
  resetDb();
  await rm(testHome, { recursive: true, force: true });
  delete process.env["KNOTES_HOME"];
});

// ─── knotes_note_create ───────────────────────────────────────────

test("knotes_note_create creates a note", async () => {
  const text = await callTool("knotes_note_create", {
    path: "notes/mcp-test",
    title: "MCP Test Note",
    content: "Hello from MCP",
    tags: ["mcp"],
  });
  expect(text).toContain("Created note:");
  expect(text).toContain("notes/mcp-test");
});

test("knotes_note_create returns error for duplicate path", async () => {
  await callTool("knotes_note_create", { path: "notes/dup" });
  const result = await client.callTool({ name: "knotes_note_create", arguments: { path: "notes/dup" } });
  expect(result.isError).toBe(true);
  const content = result.content as Array<{ type: string; text: string }>;
  expect(content[0]?.text).toContain("already exists");
});

// ─── knotes_note_get ─────────────────────────────────────────────

test("knotes_note_get returns note content", async () => {
  await callTool("knotes_note_create", {
    path: "notes/get-me",
    title: "Get Me",
    content: "Some content here",
  });

  const text = await callTool("knotes_note_get", { path: "notes/get-me" });
  expect(text).toContain("Get Me");
  expect(text).toContain("Some content here");
  expect(text).toContain("notes/get-me");
});

test("knotes_note_get returns error for non-existent note", async () => {
  const result = await client.callTool({ name: "knotes_note_get", arguments: { path: "notes/nonexistent" } });
  expect(result.isError).toBe(true);
  const content = result.content as Array<{ type: string; text: string }>;
  expect(content[0]?.text).toMatch(/not found/i);
});

// ─── knotes_note_update ──────────────────────────────────────────

test("knotes_note_update updates a note", async () => {
  await callTool("knotes_note_create", {
    path: "notes/update-me",
    title: "Old Title",
    content: "Old content",
  });

  const text = await callTool("knotes_note_update", {
    path: "notes/update-me",
    title: "New Title",
    content: "New content",
  });
  expect(text).toContain("Updated note:");
  expect(text).toContain("notes/update-me");

  // Verify via get
  const getText = await callTool("knotes_note_get", { path: "notes/update-me" });
  expect(getText).toContain("New Title");
  expect(getText).toContain("New content");
});

// ─── knotes_note_list ────────────────────────────────────────────

test("knotes_note_list lists notes", async () => {
  await callTool("knotes_note_create", { path: "notes/alpha", title: "Alpha" });
  await callTool("knotes_note_create", { path: "notes/beta", title: "Beta" });

  const text = await callTool("knotes_note_list", { prefix: "notes" });
  expect(text).toContain("notes/alpha");
  expect(text).toContain("notes/beta");
});

test("knotes_note_list returns empty message when no notes", async () => {
  const text = await callTool("knotes_note_list", { prefix: "notes" });
  expect(text).toContain("No entries found");
});

// ─── knotes_note_delete ──────────────────────────────────────────

test("knotes_note_delete deletes a note", async () => {
  await callTool("knotes_note_create", { path: "notes/delete-me" });

  const deleteText = await callTool("knotes_note_delete", { path: "notes/delete-me" });
  expect(deleteText).toContain("Deleted note:");
  expect(deleteText).toContain("notes/delete-me");

  // Verify it is gone
  const result = await client.callTool({ name: "knotes_note_get", arguments: { path: "notes/delete-me" } });
  expect(result.isError).toBe(true);
});

// ─── knotes_log_create ───────────────────────────────────────────

test("knotes_log_create creates a log", async () => {
  const text = await callTool("knotes_log_create", {
    path: "logs/daily",
    title: "Daily Log",
  });
  expect(text).toContain("Created log:");
  expect(text).toContain("logs/daily");
});

// ─── knotes_log_add ──────────────────────────────────────────────

test("knotes_log_add adds an entry to a log", async () => {
  await callTool("knotes_log_create", { path: "logs/journal" });

  const text = await callTool("knotes_log_add", {
    path: "logs/journal",
    content: "First entry content",
  });
  expect(text).toContain("Added entry");
  expect(text).toContain("logs/journal");
});

// ─── knotes_log_list ─────────────────────────────────────────────

test("knotes_log_list lists entries in a log", async () => {
  await callTool("knotes_log_create", { path: "logs/entries-test" });
  await callTool("knotes_log_add", { path: "logs/entries-test", content: "Entry one" });
  await callTool("knotes_log_add", { path: "logs/entries-test", content: "Entry two" });

  const text = await callTool("knotes_log_list", { path: "logs/entries-test" });
  expect(text).toContain("Entry one");
  expect(text).toContain("Entry two");
});

test("knotes_log_list returns empty message when no entries", async () => {
  await callTool("knotes_log_create", { path: "logs/empty" });
  const text = await callTool("knotes_log_list", { path: "logs/empty" });
  expect(text).toContain("No entries found");
});

test("knotes_log_list respects limit", async () => {
  await callTool("knotes_log_create", { path: "logs/limited" });
  await callTool("knotes_log_add", { path: "logs/limited", content: "One" });
  await callTool("knotes_log_add", { path: "logs/limited", content: "Two" });
  await callTool("knotes_log_add", { path: "logs/limited", content: "Three" });

  const text = await callTool("knotes_log_list", { path: "logs/limited", limit: 2 });
  // With limit 2, "One" (oldest) should be absent since entries are newest-first
  expect(text).toContain("Three");
  expect(text).toContain("Two");
  expect(text).not.toContain("One");
});

test("knotes_log_list filters by since", async () => {
  await callTool("knotes_log_create", { path: "logs/mcp-since" });
  await writeFile(join(testHome, "logs/mcp-since.md"), [
    "---",
    'title: mcp-since',
    "type: log",
    "---",
    "",
    "## 2025-04-06T00:00:00.000Z {#e-ee00000000000001}",
    "",
    "Old entry",
    "",
    "## 2025-04-08T12:00:00.000Z {#e-ee00000000000002}",
    "",
    "New entry",
  ].join("\n"));

  const text = await callTool("knotes_log_list", {
    path: "logs/mcp-since",
    since: "2025-04-07T00:00:00.000Z",
  });
  expect(text).toContain("New entry");
  expect(text).not.toContain("Old entry");
});

test("knotes_log_list filters by before", async () => {
  await callTool("knotes_log_create", { path: "logs/mcp-before" });
  await writeFile(join(testHome, "logs/mcp-before.md"), [
    "---",
    'title: mcp-before',
    "type: log",
    "---",
    "",
    "## 2025-04-06T00:00:00.000Z {#e-ff00000000000001}",
    "",
    "Old entry",
    "",
    "## 2025-04-08T12:00:00.000Z {#e-ff00000000000002}",
    "",
    "New entry",
  ].join("\n"));

  const text = await callTool("knotes_log_list", {
    path: "logs/mcp-before",
    before: "2025-04-07T00:00:00.000Z",
  });
  expect(text).toContain("Old entry");
  expect(text).not.toContain("New entry");
});

test("knotes_log_list filters by date range", async () => {
  await callTool("knotes_log_create", { path: "logs/mcp-range" });
  await writeFile(join(testHome, "logs/mcp-range.md"), [
    "---",
    'title: mcp-range',
    "type: log",
    "---",
    "",
    "## 2025-04-05T00:00:00.000Z {#e-1100000000000001}",
    "",
    "Too old",
    "",
    "## 2025-04-08T12:00:00.000Z {#e-1100000000000002}",
    "",
    "In range",
    "",
    "## 2025-04-12T00:00:00.000Z {#e-1100000000000003}",
    "",
    "Too new",
  ].join("\n"));

  const text = await callTool("knotes_log_list", {
    path: "logs/mcp-range",
    since: "2025-04-07T00:00:00.000Z",
    before: "2025-04-10T00:00:00.000Z",
  });
  expect(text).toContain("In range");
  expect(text).not.toContain("Too old");
  expect(text).not.toContain("Too new");
});

// ─── knotes_rename ───────────────────────────────────────────────

test("knotes_rename renames a note and migrates context hint", async () => {
  await callTool("knotes_note_create", { path: "notes/old-name", title: "Old" });
  await callTool("knotes_context_set", {
    path: "notes/old-name",
    context: "Old context",
  });

  const text = await callTool("knotes_rename", {
    oldPath: "notes/old-name",
    newPath: "notes/new-name",
  });
  expect(text).toContain("notes/new-name");

  const getText = await callTool("knotes_note_get", { path: "notes/new-name" });
  expect(getText).toContain("Old");

  const ctxText = await callTool("knotes_context_get", { path: "notes/new-name" });
  expect(ctxText).toBe("Old context");
});

test("knotes_rename rejects cross-zone rename", async () => {
  await callTool("knotes_note_create", { path: "notes/cross" });
  const result = await client.callTool({
    name: "knotes_rename",
    arguments: { oldPath: "notes/cross", newPath: "logs/cross" },
  });
  expect(result.isError).toBe(true);
});

test("knotes_log_list returns empty message when date filter excludes all entries", async () => {
  await callTool("knotes_log_create", { path: "logs/mcp-filter-empty" });
  await writeFile(join(testHome, "logs/mcp-filter-empty.md"), [
    "---",
    'title: mcp-filter-empty',
    "type: log",
    "---",
    "",
    "## 2025-04-06T00:00:00.000Z {#e-2200000000000001}",
    "",
    "Old entry",
  ].join("\n"));

  const text = await callTool("knotes_log_list", {
    path: "logs/mcp-filter-empty",
    since: "2025-04-10T00:00:00.000Z",
  });
  expect(text).toContain("No entries found");
});

// ─── read-only mode ──────────────────────────────────────────────

test("write tools are not registered in read-only mode", async () => {
  const { registerTools } = await import("../src/mcp/tools.ts");
  const roServer = new McpServer({ name: "knotes-ro-test", version: "0.0.0" });
  registerTools(roServer, { readOnly: true });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const roClient = new Client({ name: "ro-client", version: "0.0.0" });
  await roServer.connect(serverTransport);
  await roClient.connect(clientTransport);

  const { tools } = await roClient.listTools();
  const names = tools.map((t) => t.name);

  // Read-only tools should be present
  expect(names).toContain("knotes_note_get");
  expect(names).toContain("knotes_note_list");
  expect(names).toContain("knotes_log_list");
  expect(names).toContain("knotes_context_list");
  expect(names).toContain("knotes_context_get");

  // Write tools should be absent
  expect(names).not.toContain("knotes_note_create");
  expect(names).not.toContain("knotes_note_update");
  expect(names).not.toContain("knotes_note_delete");
  expect(names).not.toContain("knotes_log_create");
  expect(names).not.toContain("knotes_log_add");
  expect(names).not.toContain("knotes_context_set");
  expect(names).not.toContain("knotes_context_remove");
  expect(names).not.toContain("knotes_rename");

  await roClient.close();
  await roServer.close();
});
