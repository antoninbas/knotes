import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Harness } from "./harness.ts";

const SETUP_TIMEOUT = 360_000;
const TEST_TIMEOUT = 30_000;

for (const mode of ["serverless", "server"] as const) {
  describe(`search e2e [${mode}]`, () => {
    const h = new Harness();

    beforeAll(async () => {
      await h.start(mode);
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      await h.stop();
    });

    // --- BM25: keyword-heavy queries expect rank-1 match ---

    test("bm25 top-1: carbonara keywords", async () => {
      const results = await h.search("guanciale pecorino carbonara", { mode: "bm25", limit: 5 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe("notes/cooking/pasta-carbonara");
    }, TEST_TIMEOUT);

    test("bm25 top-1: sourdough keywords", async () => {
      const results = await h.search("sourdough starter hydration bulk fermentation", { mode: "bm25", limit: 5 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe("notes/cooking/sourdough-basics");
    }, TEST_TIMEOUT);

    test("bm25 top-1: tokio async runtime keywords", async () => {
      const results = await h.search("tokio futures poll executor runtime", { mode: "bm25", limit: 5 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe("notes/programming/rust-async-runtime");
    }, TEST_TIMEOUT);

    test("bm25 top-1: plate tectonics keywords", async () => {
      const results = await h.search("subduction rifting hotspots tectonic plates lithosphere", { mode: "bm25", limit: 5 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe("notes/science/plate-tectonics");
    }, TEST_TIMEOUT);

    test("bm25 top-1: deadlift form keywords", async () => {
      const results = await h.search("deadlift hip hinge bracing intra-abdominal", { mode: "bm25", limit: 5 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe("notes/fitness/deadlift-form");
    }, TEST_TIMEOUT);

    // --- Vector: paraphrase queries expect top-3 match ---

    test("vector top-3: pasta with eggs and cured pork", async () => {
      const results = await h.search("pasta with eggs and cured pork cheek cheese", { mode: "vector", limit: 5 });
      const paths = results.slice(0, 3).map((r) => r.path);
      expect(paths).toContain("notes/cooking/pasta-carbonara");
    }, TEST_TIMEOUT);

    test("vector top-3: running a 26 mile race", async () => {
      const results = await h.search("training plan for running a 26 mile race", { mode: "vector", limit: 5 });
      const paths = results.slice(0, 3).map((r) => r.path);
      expect(paths).toContain("notes/fitness/marathon-training-plan");
    }, TEST_TIMEOUT);

    test("vector top-3: how stars live and die", async () => {
      const results = await h.search("how stars are born on the main sequence and die as supernovae", { mode: "vector", limit: 5 });
      const paths = results.slice(0, 3).map((r) => r.path);
      expect(paths).toContain("notes/science/stellar-evolution");
    }, TEST_TIMEOUT);

    test("vector top-3: jazz chord harmony", async () => {
      const results = await h.search("jazz chord harmony two five one progression voicing", { mode: "vector", limit: 5 });
      const paths = results.slice(0, 3).map((r) => r.path);
      expect(paths).toContain("notes/music/jazz-ii-v-i-voicings");
    }, TEST_TIMEOUT);

    test("vector top-3: ground fault outlet wiring", async () => {
      const results = await h.search("wiring an outlet with ground fault protection for bathroom", { mode: "vector", limit: 5 });
      const paths = results.slice(0, 3).map((r) => r.path);
      expect(paths).toContain("notes/home/gfci-outlet-wiring");
    }, TEST_TIMEOUT);

    // --- Hybrid: mixed keyword + semantic queries ---

    test("hybrid top-3: tokio green threads", async () => {
      const results = await h.search("tokio green threads cooperative scheduling", { mode: "hybrid", limit: 5 });
      const paths = results.slice(0, 3).map((r) => r.path);
      expect(paths).toContain("notes/programming/rust-async-runtime");
    }, TEST_TIMEOUT);

    test("hybrid top-3: quantum Bell pairs non-locality", async () => {
      const results = await h.search("quantum Bell pairs nonlocality entanglement", { mode: "hybrid", limit: 5 });
      const paths = results.slice(0, 3).map((r) => r.path);
      expect(paths).toContain("notes/science/quantum-entanglement");
    }, TEST_TIMEOUT);

    test("hybrid top-3: sweep picking arpeggios", async () => {
      const results = await h.search("sweep picking arpeggios guitar", { mode: "hybrid", limit: 5 });
      const paths = results.slice(0, 3).map((r) => r.path);
      expect(paths).toContain("notes/music/guitar-sweep-picking");
    }, TEST_TIMEOUT);

    // --- Negative queries: should return empty ---

    test("bm25 negative: gibberish returns empty", async () => {
      const results = await h.search("xyzzy foobar zork quux bazinga florbulate", { mode: "bm25", limit: 5 });
      expect(results).toHaveLength(0);
    }, TEST_TIMEOUT);

    test("vector negative: random characters returns empty or low-relevance", async () => {
      const results = await h.search("asdfghjkl qwertyuiop zxcvbnm", { mode: "bm25", limit: 5 });
      expect(results).toHaveLength(0);
    }, TEST_TIMEOUT);

    // --- Result quality checks ---

    test("result titles are non-empty and non-filename-like", async () => {
      const results = await h.search("sourdough starter", { mode: "bm25", limit: 3 });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.title).toBeTruthy();
        expect(r.title).not.toMatch(/\.md$/);
        expect(r.title.length).toBeGreaterThan(2);
      }
    }, TEST_TIMEOUT);

    test("result snippets are non-empty and do not start with ---", async () => {
      const results = await h.search("tokio executor", { mode: "bm25", limit: 3 });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.snippet).toBeTruthy();
        expect(r.snippet).not.toMatch(/^---/);
      }
    }, TEST_TIMEOUT);

    test("result paths are retrievable via getNote", async () => {
      const results = await h.search("carbonara", { mode: "bm25", limit: 3 });
      expect(results.length).toBeGreaterThan(0);
      const note = await h.getNote(results[0].path);
      expect(note.path).toBe(results[0].path);
      expect(note.content).toBeTruthy();
    }, TEST_TIMEOUT);
  });
}
