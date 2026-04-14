import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let testHome: string;

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "knotes-embed-model-test-"));
  process.env["KNOTES_HOME"] = testHome;
  const { resetConfigCache, ensureHome } = await import("../src/core/config.ts");
  resetConfigCache();
  const { resetDb } = await import("../src/core/db.ts");
  resetDb();
  const { resetStore } = await import("../src/core/search.ts");
  resetStore();
  await ensureHome();
});

afterEach(async () => {
  const { resetDb } = await import("../src/core/db.ts");
  resetDb();
  await rm(testHome, { recursive: true, force: true });
  delete process.env["KNOTES_HOME"];
});

test("hasEmbedModelChanged returns false when no fingerprint is stored", async () => {
  const { hasEmbedModelChanged } = await import("../src/core/search.ts");
  // First run — no fingerprint stored yet, so no "change" to detect
  expect(await hasEmbedModelChanged()).toBe(false);
});

test("hasEmbedModelChanged returns false after embed stores fingerprint", async () => {
  const { hasEmbedModelChanged } = await import("../src/core/search.ts");
  const { setConfigValue } = await import("../src/core/db.ts");
  const { getModelDefaults } = await import("../src/core/config.ts");

  // Simulate what embed() does after success: store the current model URI
  const defaults = await getModelDefaults();
  setConfigValue("_embedModelFingerprint", defaults.embedModel);

  // Same model, no change
  expect(await hasEmbedModelChanged()).toBe(false);
});

test("hasEmbedModelChanged returns true when embed model config differs from fingerprint", async () => {
  const { hasEmbedModelChanged } = await import("../src/core/search.ts");
  const { setConfigValue } = await import("../src/core/db.ts");
  const { getModelDefaults } = await import("../src/core/config.ts");

  // Store the default as the fingerprint (simulating a previous embed run)
  const defaults = await getModelDefaults();
  setConfigValue("_embedModelFingerprint", defaults.embedModel);

  // Now change the embedModel config to something different
  setConfigValue("embedModel", "hf:some-org/some-other-model-GGUF/model.gguf");

  expect(await hasEmbedModelChanged()).toBe(true);
});

test("hasEmbedModelChanged returns false when non-embed model changes", async () => {
  const { hasEmbedModelChanged } = await import("../src/core/search.ts");
  const { setConfigValue } = await import("../src/core/db.ts");
  const { getModelDefaults } = await import("../src/core/config.ts");

  // Store the default embed model as fingerprint
  const defaults = await getModelDefaults();
  setConfigValue("_embedModelFingerprint", defaults.embedModel);

  // Change queryExpansionModel — should NOT trigger re-embed
  setConfigValue("queryExpansionModel", "hf:some-org/other-generate-model/model.gguf");

  expect(await hasEmbedModelChanged()).toBe(false);
});

test("hasEmbedModelChanged returns true when custom embedModel is changed to another custom model", async () => {
  const { hasEmbedModelChanged } = await import("../src/core/search.ts");
  const { setConfigValue } = await import("../src/core/db.ts");

  // Simulate: previously embedded with custom model A
  setConfigValue("_embedModelFingerprint", "hf:org/model-A-GGUF/model-a.gguf");
  setConfigValue("embedModel", "hf:org/model-A-GGUF/model-a.gguf");

  // No change yet
  expect(await hasEmbedModelChanged()).toBe(false);

  // Now switch to custom model B
  setConfigValue("embedModel", "hf:org/model-B-GGUF/model-b.gguf");

  expect(await hasEmbedModelChanged()).toBe(true);
});

test("hasEmbedModelChanged returns true when custom embedModel is cleared (reverts to default)", async () => {
  const { hasEmbedModelChanged } = await import("../src/core/search.ts");
  const { setConfigValue } = await import("../src/core/db.ts");

  // Simulate: previously embedded with custom model
  const customUri = "hf:org/custom-embed-GGUF/custom.gguf";
  setConfigValue("_embedModelFingerprint", customUri);
  setConfigValue("embedModel", customUri);

  expect(await hasEmbedModelChanged()).toBe(false);

  // Clear the custom model — reverts to default, which differs from fingerprint
  setConfigValue("embedModel", "");

  expect(await hasEmbedModelChanged()).toBe(true);
});

test("API: POST /api/config/notify returns no actions when no change", async () => {
  const { createApp } = await import("../src/web/server.ts");
  const app = createApp();

  // No fingerprint stored — hasEmbedModelChanged returns false
  const res = await app.request("/api/config/notify", { method: "POST" });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.actions).toEqual([]);
});

test("API: POST /api/config/notify triggers reembed when embed model changed", async () => {
  const { createApp } = await import("../src/web/server.ts");
  const { setConfigValue } = await import("../src/core/db.ts");
  const { getModelDefaults } = await import("../src/core/config.ts");
  const app = createApp();

  // Store a fingerprint, then change the model
  const defaults = await getModelDefaults();
  setConfigValue("_embedModelFingerprint", defaults.embedModel);
  setConfigValue("embedModel", "hf:org/different-model-GGUF/different.gguf");

  const res = await app.request("/api/config/notify", { method: "POST" });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.actions).toContain("reembed");
});
