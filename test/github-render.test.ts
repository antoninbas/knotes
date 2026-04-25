import { test, expect } from "vitest";
import { __test__ } from "../src/core/github/sync.ts";

const { renderPR, renderIssue, renderReview, stateHashOf } = __test__;

const repo = {
  name: "thing",
  nameWithOwner: "acme/thing",
  owner: { login: "acme" },
};

test("renderPR (OPEN) uses createdAt timestamp and the Opened PR title", () => {
  const r = renderPR({
    id: "PR_NID1",
    number: 42,
    title: "Add the thing",
    url: "https://github.com/acme/thing/pull/42",
    state: "OPEN",
    isDraft: false,
    createdAt: "2026-04-20T10:00:00Z",
    updatedAt: "2026-04-20T10:00:00Z",
    mergedAt: null,
    closedAt: null,
    additions: 12,
    deletions: 3,
    baseRefName: "main",
    repository: repo,
  });
  expect(r.timestamp).toBe("2026-04-20T10:00:00Z");
  expect(r.content).toContain("**Opened PR**");
  expect(r.content).toContain("acme/thing#42 — Add the thing");
  expect(r.content).toContain("<!-- gh-event:pr:PR_NID1 -->");
});

test("renderPR (MERGED) uses mergedAt and shows additions/deletions", () => {
  const r = renderPR({
    id: "PR_NID1",
    number: 42,
    title: "Add the thing",
    url: "https://github.com/acme/thing/pull/42",
    state: "MERGED",
    isDraft: false,
    createdAt: "2026-04-20T10:00:00Z",
    updatedAt: "2026-04-23T14:00:00Z",
    mergedAt: "2026-04-23T14:00:00Z",
    closedAt: "2026-04-23T14:00:00Z",
    additions: 120,
    deletions: 34,
    baseRefName: "main",
    repository: repo,
  });
  expect(r.timestamp).toBe("2026-04-23T14:00:00Z");
  expect(r.content).toContain("**Merged PR**");
  expect(r.content).toContain("+120 / −34");
});

test("renderPR (OPEN, draft) flags draft state", () => {
  const r = renderPR({
    id: "PR_NID2",
    number: 7,
    title: "WIP",
    url: "https://github.com/acme/thing/pull/7",
    state: "OPEN",
    isDraft: true,
    createdAt: "2026-04-20T10:00:00Z",
    updatedAt: "2026-04-20T10:00:00Z",
    mergedAt: null,
    closedAt: null,
    additions: 0,
    deletions: 0,
    baseRefName: "main",
    repository: repo,
  });
  expect(r.content).toContain("(draft)");
});

test("renderIssue (OPEN) includes labels", () => {
  const r = renderIssue({
    id: "ISS_NID1",
    number: 5,
    title: "Crash on startup",
    url: "https://github.com/acme/thing/issues/5",
    state: "OPEN",
    createdAt: "2026-04-22T08:30:00Z",
    updatedAt: "2026-04-22T08:30:00Z",
    closedAt: null,
    labels: { nodes: [{ name: "bug" }, { name: "regression" }] },
    repository: repo,
  });
  expect(r.content).toContain("**Opened issue**");
  expect(r.content).toContain("Labels: bug, regression");
  expect(r.content).toContain("<!-- gh-event:issue:ISS_NID1 -->");
});

test("renderReview surfaces state and submission timestamp", () => {
  const pr = {
    number: 11,
    title: "Refactor pipeline",
    url: "https://github.com/acme/thing/pull/11",
    repository: repo,
    reviews: { nodes: [] },
  };
  const review = {
    id: "REV_NID1",
    state: "APPROVED",
    submittedAt: "2026-04-23T15:01:00Z",
    comments: { totalCount: 4 },
  };
  const r = renderReview(pr, review);
  expect(r.timestamp).toBe("2026-04-23T15:01:00Z");
  expect(r.content).toContain("**Reviewed PR**");
  expect(r.content).toContain("State: APPROVED");
  expect(r.content).toContain("4 comments");
});

test("stateHashOf is deterministic and changes on content change", () => {
  const a = stateHashOf("hello");
  const b = stateHashOf("hello");
  const c = stateHashOf("hello!");
  expect(a).toBe(b);
  expect(a).not.toBe(c);
  expect(a).toHaveLength(12);
});
