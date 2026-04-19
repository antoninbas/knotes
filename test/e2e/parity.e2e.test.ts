import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Harness } from "./harness.ts";

const SETUP_TIMEOUT = 360_000;
const TEST_TIMEOUT = 30_000;

describe("parity e2e [serverless vs server]", () => {
  const serverless = new Harness();
  const server = new Harness();

  beforeAll(async () => {
    // Start both modes; do them sequentially to avoid env var conflicts
    await serverless.start("serverless");
    await server.start("server");
  }, SETUP_TIMEOUT * 2);

  afterAll(async () => {
    await serverless.stop();
    await server.stop();
  });

  const searchQueries = [
    { q: "carbonara recipe guanciale pecorino", mode: "bm25" as const, needsEmbed: false },
    { q: "semantic concept of cooperative concurrency async", mode: "vector" as const, needsEmbed: true },
    { q: "quantum measurement Bell state nonlocality", mode: "hybrid" as const, needsEmbed: true },
  ];

  for (const { q, mode, needsEmbed } of searchQueries) {
    test.skipIf(needsEmbed && !!process.env["CI"])(`search parity: "${q}" [${mode}]`, async () => {
      const a = await serverless.search(q, { mode, limit: 10 });
      const b = await server.search(q, { mode, limit: 10 });

      expect(a.length).toBeGreaterThan(0);
      expect(b.map((r) => r.path)).toEqual(a.map((r) => r.path));
      expect(b.map((r) => r.title)).toEqual(a.map((r) => r.title));
    }, TEST_TIMEOUT);
  }

  test("listNotes parity", async () => {
    const a = await serverless.listNotes("notes/cooking");
    const b = await server.listNotes("notes/cooking");
    expect(b.map((e) => e.path).sort()).toEqual(a.map((e) => e.path).sort());
    expect(b.map((e) => e.title).sort()).toEqual(a.map((e) => e.title).sort());
  }, TEST_TIMEOUT);

  test("listJournals parity", async () => {
    const a = await serverless.listJournals("logs");
    const b = await server.listJournals("logs");
    expect(b.map((e) => e.path).sort()).toEqual(a.map((e) => e.path).sort());
  }, TEST_TIMEOUT);
});
