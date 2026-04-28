import { createHash } from "node:crypto";
import {
  recordJobStart,
  recordJobComplete,
  recordJobFailed,
} from "../db.ts";
import { upsertEntryFromSource, scanGithubMarkers } from "../logs.ts";
import {
  getAccountById,
  getConnection,
  getSyncedEvent,
  listConnections as dbListConnections,
  upsertSyncedEvent,
  updateConnection as dbUpdateConnection,
  markAccountNeedsReauth,
} from "./db.ts";
import { getAuthHeader } from "./auth.ts";
import { createClient, RateLimitError, GhApiError } from "./api.ts";
import { VaultLockedError } from "../vault.ts";
import { passesFilters } from "./connections.ts";
import type {
  GhAccount,
  GhBodyMode,
  GhConnection,
  GhMonitor,
  GhSyncResult,
} from "./types.ts";
import type { GhClient } from "./api.ts";

// Test suites can pass a mock that satisfies this shape.
export type SyncClient = GhClient;

// --- GraphQL queries ---

function prSearchQuery(includeBody: boolean): string {
  return /* GraphQL */ `
    query SearchPRs($q: String!, $cursor: String) {
      rateLimit { cost remaining resetAt }
      search(type: ISSUE, query: $q, first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ... on PullRequest {
            id
            number
            title
            ${includeBody ? "body" : ""}
            url
            state
            isDraft
            createdAt
            updatedAt
            mergedAt
            closedAt
            additions
            deletions
            baseRefName
            repository { name nameWithOwner owner { login } }
          }
        }
      }
    }
  `;
}

function issueSearchQuery(includeBody: boolean): string {
  return /* GraphQL */ `
    query SearchIssues($q: String!, $cursor: String) {
      rateLimit { cost remaining resetAt }
      search(type: ISSUE, query: $q, first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ... on Issue {
            id
            number
            title
            ${includeBody ? "body" : ""}
            url
            state
            createdAt
            updatedAt
            closedAt
            labels(first: 10) { nodes { name } }
            repository { name nameWithOwner owner { login } }
          }
        }
      }
    }
  `;
}

const REVIEW_SEARCH_QUERY = /* GraphQL */ `
  query SearchReviewedPRs($q: String!, $cursor: String, $viewer: String!) {
    rateLimit { cost remaining resetAt }
    search(type: ISSUE, query: $q, first: 25, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number
          title
          url
          repository { name nameWithOwner owner { login } }
          reviews(first: 50, author: $viewer) {
            nodes {
              id
              state
              submittedAt
              comments { totalCount }
            }
          }
        }
      }
    }
  }
`;

interface PRNode {
  id: string;
  number: number;
  title: string;
  body: string | null;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  additions: number;
  deletions: number;
  baseRefName: string;
  repository: { name: string; nameWithOwner: string; owner: { login: string } };
}

interface IssueNode {
  id: string;
  number: number;
  title: string;
  body: string | null;
  url: string;
  state: "OPEN" | "CLOSED";
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  labels: { nodes: Array<{ name: string }> };
  repository: { name: string; nameWithOwner: string; owner: { login: string } };
}

interface ReviewedPRNode {
  number: number;
  title: string;
  url: string;
  repository: { name: string; nameWithOwner: string; owner: { login: string } };
  reviews: {
    nodes: Array<{
      id: string;
      state: string;
      submittedAt: string | null;
      comments: { totalCount: number };
    }>;
  };
}

interface SearchPage<T> {
  search: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: T[];
  };
}

// --- Date helpers ---

function isoDate(iso: string): string {
  // GitHub's search query language wants YYYY-MM-DDTHH:MM:SS+00:00 form.
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function effectiveCutoff(connection: GhConnection): string {
  if (!connection.lastSyncedAt) return connection.since;
  // Overlap by 1 hour to catch updates we may have missed near the boundary.
  const ms = new Date(connection.lastSyncedAt).getTime() - 60 * 60 * 1000;
  const lower = Math.max(ms, new Date(connection.since).getTime());
  return new Date(lower).toISOString();
}

// --- Rendering ---

function bold(s: string): string {
  return `**${s}**`;
}

/**
 * Reduce a PR/issue body to the requested shape and emit a quoted block,
 * or "" if there's nothing to include. Always trims trailing whitespace
 * and normalizes CRLF to LF before slicing so character counts match what
 * the user sees.
 */
function formatBody(
  body: string | null | undefined,
  mode: GhBodyMode,
  maxChars: number | null
): string {
  if (mode === "title" || !body) return "";
  const normalized = body.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  let chosen: string;
  let truncated = false;
  if (mode === "full") {
    chosen = normalized;
  } else if (mode === "first_paragraph") {
    const idx = normalized.indexOf("\n\n");
    chosen = idx >= 0 ? normalized.slice(0, idx).trim() : normalized;
    truncated = idx >= 0 && idx < normalized.length;
  } else {
    // first_chars
    const limit = maxChars ?? 0;
    if (limit <= 0 || normalized.length <= limit) {
      chosen = normalized;
    } else {
      chosen = normalized.slice(0, limit).trimEnd();
      truncated = true;
    }
  }

  if (!chosen) return "";
  const quoted = chosen
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return "\n\n" + quoted + (truncated ? "\n> …" : "");
}

function renderPR(
  node: PRNode,
  bodyMode: GhBodyMode = "title",
  bodyMaxChars: number | null = null
): { content: string; timestamp: string } {
  const link = `[${node.repository.nameWithOwner}#${node.number} — ${node.title}](${node.url})`;
  const bodyBlock = formatBody(node.body, bodyMode, bodyMaxChars);
  if (node.state === "MERGED") {
    const ts = node.mergedAt ?? node.updatedAt;
    return {
      content:
        `${bold("Merged PR")} ${link}\n\n` +
        `+${node.additions} / −${node.deletions} into \`${node.baseRefName}\` · merged ${ts}` +
        bodyBlock +
        `\n\n<!-- gh-event:pr:${node.id} -->`,
      timestamp: ts,
    };
  }
  if (node.state === "CLOSED") {
    const ts = node.closedAt ?? node.updatedAt;
    return {
      content:
        `${bold("Closed PR")} ${link}\n\n` +
        `State: CLOSED · base \`${node.baseRefName}\` · closed without merging ${ts}` +
        bodyBlock +
        `\n\n<!-- gh-event:pr:${node.id} -->`,
      timestamp: ts,
    };
  }
  // OPEN
  const draft = node.isDraft ? " (draft)" : "";
  const ts = node.createdAt;
  return {
    content:
      `${bold("Opened PR")} ${link}\n\n` +
      `State: OPEN${draft} · base \`${node.baseRefName}\` · opened ${ts}` +
      bodyBlock +
      `\n\n<!-- gh-event:pr:${node.id} -->`,
    timestamp: ts,
  };
}

function renderIssue(
  node: IssueNode,
  bodyMode: GhBodyMode = "title",
  bodyMaxChars: number | null = null
): { content: string; timestamp: string } {
  const link = `[${node.repository.nameWithOwner}#${node.number} — ${node.title}](${node.url})`;
  const labels = node.labels.nodes.map((l) => l.name).filter(Boolean).join(", ");
  const labelLine = labels ? `\n\nLabels: ${labels}` : "";
  const bodyBlock = formatBody(node.body, bodyMode, bodyMaxChars);
  if (node.state === "CLOSED") {
    const ts = node.closedAt ?? node.updatedAt;
    return {
      content:
        `${bold("Closed issue")} ${link}\n\n` +
        `State: CLOSED · closed ${ts}` +
        labelLine +
        bodyBlock +
        `\n\n<!-- gh-event:issue:${node.id} -->`,
      timestamp: ts,
    };
  }
  const ts = node.createdAt;
  return {
    content:
      `${bold("Opened issue")} ${link}\n\n` +
      `State: OPEN · opened ${ts}` +
      labelLine +
      bodyBlock +
      `\n\n<!-- gh-event:issue:${node.id} -->`,
    timestamp: ts,
  };
}

function renderReview(
  pr: ReviewedPRNode,
  review: ReviewedPRNode["reviews"]["nodes"][number]
): { content: string; timestamp: string } {
  const link = `[${pr.repository.nameWithOwner}#${pr.number} — ${pr.title}](${pr.url})`;
  const ts = review.submittedAt ?? new Date().toISOString();
  return {
    content:
      `${bold("Reviewed PR")} ${link}\n\n` +
      `State: ${review.state} · ${review.comments.totalCount} comments · ${ts}\n\n` +
      `<!-- gh-event:review:${review.id} -->`,
    timestamp: ts,
  };
}

function stateHashOf(content: string): string {
  return createHash("sha1").update(content).digest("hex").slice(0, 12);
}

// --- Pagination helpers ---

const GRAPHQL_POINTS_LOW_WATER = 500;

async function paginatedSearch<T>(
  client: SyncClient,
  query: string,
  q: string,
  extraVars: Record<string, unknown> = {}
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null = null;
  // Hard cap — don't run away. Surplus picked up next interval.
  const HARD_CAP = 500;
  while (all.length < HARD_CAP) {
    const data = (await client.graphql(query, {
      q,
      cursor,
      ...extraVars,
    })) as SearchPage<T>;
    const rl = client.rateLimitInfo();
    if (rl.graphQLRemaining !== null && rl.graphQLRemaining < GRAPHQL_POINTS_LOW_WATER) {
      throw new RateLimitError(
        `GitHub GraphQL rate limit low (${rl.graphQLRemaining} points remaining)`,
        rl.graphQLResetAt
      );
    }
    all.push(...data.search.nodes);
    if (!data.search.pageInfo.hasNextPage) break;
    cursor = data.search.pageInfo.endCursor;
  }
  return all;
}

// --- Fetchers ---

async function fetchPRs(
  client: SyncClient,
  cutoff: string,
  includeBody: boolean
): Promise<PRNode[]> {
  const q = `is:pr author:@me updated:>=${isoDate(cutoff)}`;
  const nodes = await paginatedSearch<PRNode>(client, prSearchQuery(includeBody), q);
  return nodes.filter((n) => n && n.id);
}

async function fetchIssues(
  client: SyncClient,
  cutoff: string,
  includeBody: boolean
): Promise<IssueNode[]> {
  const q = `is:issue author:@me updated:>=${isoDate(cutoff)}`;
  const nodes = await paginatedSearch<IssueNode>(client, issueSearchQuery(includeBody), q);
  return nodes.filter((n) => n && n.id);
}

async function fetchReviewedPRs(
  client: SyncClient,
  viewer: string,
  cutoff: string
): Promise<ReviewedPRNode[]> {
  const q = `is:pr reviewed-by:@me updated:>=${isoDate(cutoff)}`;
  const nodes = await paginatedSearch<ReviewedPRNode>(
    client,
    REVIEW_SEARCH_QUERY,
    q,
    { viewer }
  );
  return nodes.filter((n) => n && n.repository);
}

// --- Per-event processor ---

interface ProcessedEvent {
  eventId: string;
  url: string;
  content: string;
  timestamp: string;
  owner: string;
  repo: string;
}

async function processEvent(
  conn: GhConnection,
  event: ProcessedEvent,
  markers: Map<string, string>
): Promise<"written" | "updated" | "skipped"> {
  if (
    !passesFilters(
      {
        includeOrgs: conn.includeOrgs,
        excludeOrgs: conn.excludeOrgs,
        includeRepos: conn.includeRepos,
        excludeRepos: conn.excludeRepos,
      },
      event.owner,
      event.repo
    )
  ) {
    return "skipped";
  }

  const newHash = stateHashOf(event.content);
  const existing = getSyncedEvent(conn.id, event.eventId);

  if (existing) {
    if (existing.stateHash === newHash) return "skipped";
    const updated = await upsertEntryFromSource(conn.logPath, {
      entryId: existing.entryId,
      timestamp: event.timestamp,
      content: event.content,
    });
    upsertSyncedEvent({
      connectionId: conn.id,
      eventId: event.eventId,
      entryId: updated.id,
      timestamp: event.timestamp,
      stateHash: newHash,
      url: event.url,
    });
    return "updated";
  }

  // Marker recovery: if the markdown already has this event's marker but the
  // DB row is missing (crash between writes, restored backup), adopt the
  // existing entry id rather than creating a duplicate.
  const adoptedId = markers.get(event.eventId);
  const written = await upsertEntryFromSource(conn.logPath, {
    entryId: adoptedId,
    timestamp: event.timestamp,
    content: event.content,
  });
  upsertSyncedEvent({
    connectionId: conn.id,
    eventId: event.eventId,
    entryId: written.id,
    timestamp: event.timestamp,
    stateHash: newHash,
    url: event.url,
  });
  return adoptedId ? "updated" : "written";
}

// --- Public entry points ---

/**
 * Per-connection mutex. The whole syncConnection body reads then writes the
 * markdown file; two concurrent runs (e.g. background + UI-triggered) would
 * otherwise read the same pre-image and clobber each other on write.
 */
const inflight = new Map<number, Promise<GhSyncResult>>();

export async function syncConnection(
  connectionId: number,
  client?: SyncClient,
  trigger: "manual" | "background" | "cli" = "cli"
): Promise<GhSyncResult> {
  const existing = inflight.get(connectionId);
  if (existing) return existing;
  const p = syncConnectionImpl(connectionId, client, trigger);
  inflight.set(connectionId, p);
  try {
    return await p;
  } finally {
    inflight.delete(connectionId);
  }
}

async function syncConnectionImpl(
  connectionId: number,
  client?: SyncClient,
  trigger: "manual" | "background" | "cli" = "cli"
): Promise<GhSyncResult> {
  const conn = getConnection(connectionId);
  if (!conn) throw new Error(`Connection not found: ${connectionId}`);
  if (!conn.enabled) {
    return {
      connectionId,
      logPath: conn.logPath,
      pulled: 0,
      written: 0,
      updated: 0,
      skipped: 0,
      rateLimited: false,
      authError: false,
    };
  }

  const account = getAccountById(conn.accountId);
  if (!account) throw new Error(`Account not found for connection ${connectionId}`);
  if (account.needsReauth) {
    return {
      connectionId,
      logPath: conn.logPath,
      pulled: 0,
      written: 0,
      updated: 0,
      skipped: 0,
      rateLimited: false,
      authError: true,
    };
  }

  const ghClient: SyncClient =
    client ??
    createClient({
      authHeader: await getAuthHeader(account.id),
      host: account.host,
    });

  const jobId = recordJobStart(`github:sync:${conn.logPath}`);
  const startedAt = Date.now();
  let pulled = 0;
  let written = 0;
  let updated = 0;
  let skipped = 0;
  let rateLimited = false;
  let resetAt: string | null = null;

  try {
    const cutoff = effectiveCutoff(conn);
    const markers = await scanGithubMarkers(conn.logPath);
    const events = await collectEvents(ghClient, conn, account, cutoff);
    pulled = events.length;

    let maxTimestamp: string | null = null;
    for (const event of events) {
      const result = await processEvent(conn, event, markers);
      if (result === "written") written++;
      else if (result === "updated") updated++;
      else skipped++;
      if (!maxTimestamp || event.timestamp > maxTimestamp) {
        maxTimestamp = event.timestamp;
      }
    }

    const newLastSyncedAt = maxTimestamp ?? new Date().toISOString();
    dbUpdateConnection(conn.id, { lastSyncedAt: newLastSyncedAt });

    recordJobComplete(jobId, Date.now() - startedAt, {
      pulled,
      written,
      updated,
      skipped,
      rateLimited,
      monitors: conn.monitors,
      trigger,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      rateLimited = true;
      resetAt = err.resetAt;
      recordJobComplete(jobId, Date.now() - startedAt, {
        pulled,
        written,
        updated,
        skipped,
        rateLimited,
        resetAt,
        monitors: conn.monitors,
        trigger,
      });
    } else if (err instanceof GhApiError && err.status === 401) {
      markAccountNeedsReauth(account.id);
      recordJobFailed(
        jobId,
        `Token revoked or invalid for ${account.host}:${account.login}`,
        Date.now() - startedAt
      );
      return {
        connectionId,
        logPath: conn.logPath,
        pulled: 0,
        written: 0,
        updated: 0,
        skipped: 0,
        rateLimited: false,
        authError: true,
      };
    } else if (err instanceof VaultLockedError) {
      recordJobFailed(
        jobId,
        err.message,
        Date.now() - startedAt
      );
      return {
        connectionId,
        logPath: conn.logPath,
        pulled: 0,
        written: 0,
        updated: 0,
        skipped: 0,
        rateLimited: false,
        authError: false,
      };
    } else {
      recordJobFailed(
        jobId,
        err instanceof Error ? err.message : String(err),
        Date.now() - startedAt
      );
      throw err;
    }
  }

  return {
    connectionId,
    logPath: conn.logPath,
    pulled,
    written,
    updated,
    skipped,
    rateLimited,
    authError: false,
    ...(resetAt ? { nextRetryAt: resetAt } : {}),
  };
}

async function collectEvents(
  client: SyncClient,
  conn: GhConnection,
  account: GhAccount,
  cutoff: string
): Promise<ProcessedEvent[]> {
  const events: ProcessedEvent[] = [];
  const monitors = new Set<GhMonitor>(conn.monitors);
  const includeBody = conn.bodyMode !== "title";

  if (monitors.has("opened_prs") || monitors.has("merged_prs")) {
    const prs = await fetchPRs(client, cutoff, includeBody);
    for (const pr of prs) {
      // opened_prs tracks PRs through their full lifecycle (OPEN/CLOSED/MERGED);
      // merged_prs surfaces only landed PRs. With merged_prs alone selected,
      // skip OPEN and CLOSED-without-merge.
      if (!monitors.has("opened_prs") && pr.state !== "MERGED") continue;
      const rendered = renderPR(pr, conn.bodyMode, conn.bodyMaxChars);
      events.push({
        eventId: `pr:${pr.id}`,
        url: pr.url,
        content: rendered.content,
        timestamp: rendered.timestamp,
        owner: pr.repository.owner.login,
        repo: pr.repository.name,
      });
    }
  }

  if (monitors.has("opened_issues")) {
    const issues = await fetchIssues(client, cutoff, includeBody);
    for (const iss of issues) {
      const rendered = renderIssue(iss, conn.bodyMode, conn.bodyMaxChars);
      events.push({
        eventId: `issue:${iss.id}`,
        url: iss.url,
        content: rendered.content,
        timestamp: rendered.timestamp,
        owner: iss.repository.owner.login,
        repo: iss.repository.name,
      });
    }
  }

  if (monitors.has("pr_reviews")) {
    const reviewed = await fetchReviewedPRs(client, account.login, cutoff);
    const cutoffMs = new Date(cutoff).getTime();
    for (const pr of reviewed) {
      for (const review of pr.reviews.nodes) {
        if (!review.submittedAt) continue;
        if (new Date(review.submittedAt).getTime() < cutoffMs) continue;
        const rendered = renderReview(pr, review);
        events.push({
          eventId: `review:${review.id}`,
          url: pr.url,
          content: rendered.content,
          timestamp: rendered.timestamp,
          owner: pr.repository.owner.login,
          repo: pr.repository.name,
        });
      }
    }
  }

  return events;
}

export async function syncForLog(logPath: string): Promise<GhSyncResult[]> {
  const conns = dbListConnections({ logPath });
  const results: GhSyncResult[] = [];
  for (const c of conns) {
    results.push(await syncConnection(c.id));
  }
  return results;
}

export async function syncAll(opts?: {
  trigger?: "manual" | "background" | "cli";
}): Promise<GhSyncResult[]> {
  const conns = dbListConnections();
  const results: GhSyncResult[] = [];
  for (const c of conns) {
    if (!c.enabled) continue;
    results.push(await syncConnection(c.id, undefined, opts?.trigger ?? "cli"));
  }
  return results;
}

// Re-export render helpers for tests.
export const __test__ = {
  renderPR,
  renderIssue,
  renderReview,
  stateHashOf,
};
