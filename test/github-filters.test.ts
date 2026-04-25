import { test, expect } from "vitest";
import { passesFilters } from "../src/core/github/connections.ts";
import { normalizeHost } from "../src/core/github/api.ts";

test("passesFilters allows everything when no filters set", () => {
  const f = {
    includeOrgs: null,
    excludeOrgs: null,
    includeRepos: null,
    excludeRepos: null,
  };
  expect(passesFilters(f, "acme", "thing")).toBe(true);
  expect(passesFilters(f, "Other", "Repo")).toBe(true);
});

test("passesFilters honors includeOrgs (case-insensitive)", () => {
  const f = {
    includeOrgs: ["acme"],
    excludeOrgs: null,
    includeRepos: null,
    excludeRepos: null,
  };
  expect(passesFilters(f, "ACME", "any")).toBe(true);
  expect(passesFilters(f, "Other", "any")).toBe(false);
});

test("passesFilters honors excludeOrgs", () => {
  const f = {
    includeOrgs: null,
    excludeOrgs: ["bots"],
    includeRepos: null,
    excludeRepos: null,
  };
  expect(passesFilters(f, "acme", "x")).toBe(true);
  expect(passesFilters(f, "BOTS", "x")).toBe(false);
});

test("passesFilters includeRepos requires owner/repo match", () => {
  const f = {
    includeOrgs: null,
    excludeOrgs: null,
    includeRepos: ["acme/thing"],
    excludeRepos: null,
  };
  expect(passesFilters(f, "acme", "thing")).toBe(true);
  expect(passesFilters(f, "acme", "other")).toBe(false);
  expect(passesFilters(f, "ACME", "Thing")).toBe(true);
});

test("passesFilters excludeRepos overrides include path", () => {
  const f = {
    includeOrgs: ["acme"],
    excludeOrgs: null,
    includeRepos: null,
    excludeRepos: ["acme/secret"],
  };
  expect(passesFilters(f, "acme", "open")).toBe(true);
  expect(passesFilters(f, "acme", "secret")).toBe(false);
});

test("passesFilters: includeOrgs missing fails before excludeOrgs check", () => {
  const f = {
    includeOrgs: ["acme"],
    excludeOrgs: ["bots"],
    includeRepos: null,
    excludeRepos: null,
  };
  expect(passesFilters(f, "other", "x")).toBe(false);
});

test("normalizeHost strips schemes, paths, and lowercases", () => {
  expect(normalizeHost("github.com")).toBe("github.com");
  expect(normalizeHost("GITHUB.COM")).toBe("github.com");
  expect(normalizeHost("https://ghe.example.com/")).toBe("ghe.example.com");
  expect(normalizeHost("http://ghe.example.com/foo/bar")).toBe("ghe.example.com");
  expect(normalizeHost("  ghe.example.com  ")).toBe("ghe.example.com");
});
