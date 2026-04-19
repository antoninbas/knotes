import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Harness } from "./harness.ts";

const SETUP_TIMEOUT = 360_000;
const TEST_TIMEOUT = 30_000;

for (const mode of ["serverless", "server"] as const) {
  describe(`filters e2e [${mode}]`, () => {
    const h = new Harness();

    beforeAll(async () => {
      await h.start(mode);
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      await h.stop();
    });

    // --- Collection filters ---

    test("collections:notes excludes logs paths", async () => {
      const results = await h.search("training running workout", {
        mode: "hybrid",
        limit: 10,
        collections: ["notes"],
      });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.path).not.toMatch(/^logs\//);
        expect(r.path).toMatch(/^notes\//);
      }
    }, TEST_TIMEOUT);

    test("collections:logs excludes notes paths", async () => {
      const results = await h.search("training running workout", {
        mode: "hybrid",
        limit: 10,
        collections: ["logs"],
      });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.path).not.toMatch(/^notes\//);
        expect(r.path).toMatch(/^logs\//);
      }
    }, TEST_TIMEOUT);

    test("collections:[notes,logs] returns both types", async () => {
      const results = await h.search("cooking", {
        mode: "hybrid",
        limit: 20,
        collections: ["notes", "logs"],
      });
      expect(results.length).toBeGreaterThan(0);
      const hasNote = results.some((r) => r.path.startsWith("notes/"));
      const hasLog = results.some((r) => r.path.startsWith("logs/"));
      expect(hasNote).toBe(true);
      expect(hasLog).toBe(true);
    }, TEST_TIMEOUT);

    // --- minScore filter ---

    test("minScore:0 equivalent to no filter", async () => {
      const noFilter = await h.search("sourdough", { mode: "bm25", limit: 5 });
      const withZero = await h.search("sourdough", { mode: "bm25", limit: 5, minScore: 0 });
      expect(withZero.map((r) => r.path)).toEqual(noFilter.map((r) => r.path));
    }, TEST_TIMEOUT);

    test("minScore:999 returns empty results", async () => {
      for (const searchMode of ["bm25", "vector", "hybrid"] as const) {
        const results = await h.search("sourdough", { mode: searchMode, limit: 5, minScore: 999 });
        expect(results).toHaveLength(0);
      }
    }, TEST_TIMEOUT);

    test("minScore mid-range drops some results from top-5", async () => {
      const unfiltered = await h.search("cooking", { mode: "bm25", limit: 5 });
      if (unfiltered.length < 2) return; // skip if corpus doesn't give enough results

      // Find a mid-range threshold: use the score of the lowest result
      const lowestScore = unfiltered[unfiltered.length - 1].score;
      const highestScore = unfiltered[0].score;
      // Only meaningful if there's a range
      if (lowestScore >= highestScore) return;

      const midScore = lowestScore + (highestScore - lowestScore) * 0.5;
      const filtered = await h.search("cooking", { mode: "bm25", limit: 5, minScore: midScore });

      // Filtered count should be less than unfiltered
      expect(filtered.length).toBeLessThan(unfiltered.length);
      // Every filtered result should have score >= threshold
      for (const r of filtered) {
        expect(r.score).toBeGreaterThanOrEqual(midScore);
      }
    }, TEST_TIMEOUT);
  });
}
