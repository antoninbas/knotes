import { getVersion } from "../version.ts";
import type { GhAccount } from "./types.ts";

export class RateLimitError extends Error {
  resetAt: string | null;
  constructor(message: string, resetAt: string | null) {
    super(message);
    this.name = "RateLimitError";
    this.resetAt = resetAt;
  }
}

export class GhApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "GhApiError";
    this.status = status;
    this.body = body;
  }
}

export interface GhClient {
  graphql<T>(query: string, vars?: Record<string, unknown>): Promise<T>;
  rest<T>(path: string, init?: RequestInit): Promise<T>;
  rateLimitInfo(): { remaining: number | null; resetAt: string | null };
  resolveViewer(): Promise<{ login: string; nodeId: string; scopes: string | null }>;
}

interface ApiUrls {
  rest: string;
  graphql: string;
}

function urlsFor(host: string): ApiUrls {
  if (host === "github.com") {
    return {
      rest: "https://api.github.com",
      graphql: "https://api.github.com/graphql",
    };
  }
  return {
    rest: `https://${host}/api/v3`,
    graphql: `https://${host}/api/graphql`,
  };
}

export function normalizeHost(input: string): string {
  let h = input.trim();
  h = h.replace(/^https?:\/\//, "");
  h = h.replace(/\/.*$/, "");
  return h.toLowerCase();
}

interface ClientOpts {
  authHeader: string;
  host: string;
  fetchImpl?: typeof fetch;
}

export function createClient(opts: ClientOpts): GhClient {
  const urls = urlsFor(opts.host);
  const fetchImpl = opts.fetchImpl ?? fetch;
  let lastRemaining: number | null = null;
  let lastResetAt: string | null = null;

  function trackRateLimit(res: Response) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    if (remaining !== null) lastRemaining = parseInt(remaining, 10);
    if (reset !== null) {
      lastResetAt = new Date(parseInt(reset, 10) * 1000).toISOString();
    }
  }

  async function checkRateLimit(res: Response): Promise<void> {
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        throw new RateLimitError(
          `GitHub rate limit exceeded`,
          lastResetAt
        );
      }
    }
  }

  return {
    async rest<T>(path: string, init?: RequestInit): Promise<T> {
      const url = path.startsWith("http") ? path : `${urls.rest}${path}`;
      const res = await fetchImpl(url, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": `knotes/${getVersion()}`,
          Authorization: opts.authHeader,
          ...init?.headers,
        },
      });
      trackRateLimit(res);
      await checkRateLimit(res);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new GhApiError(res.status, `GitHub REST ${res.status}`, body);
      }
      return (await res.json()) as T;
    },

    async graphql<T>(query: string, vars?: Record<string, unknown>): Promise<T> {
      const res = await fetchImpl(urls.graphql, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `knotes/${getVersion()}`,
          Authorization: opts.authHeader,
        },
        body: JSON.stringify({ query, variables: vars ?? {} }),
      });
      trackRateLimit(res);
      await checkRateLimit(res);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new GhApiError(res.status, `GitHub GraphQL ${res.status}`, body);
      }
      const payload = (await res.json()) as { data?: T; errors?: unknown[] };
      if (payload.errors && payload.errors.length > 0) {
        throw new GhApiError(200, "GitHub GraphQL errors", payload.errors);
      }
      return payload.data as T;
    },

    rateLimitInfo() {
      return { remaining: lastRemaining, resetAt: lastResetAt };
    },

    async resolveViewer() {
      const url = `${urls.rest}/user`;
      const res = await fetchImpl(url, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `knotes/${getVersion()}`,
          Authorization: opts.authHeader,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new GhApiError(res.status, `GitHub /user ${res.status}`, body);
      }
      const scopes = res.headers.get("x-oauth-scopes");
      const data = (await res.json()) as { login: string; node_id: string };
      return { login: data.login, nodeId: data.node_id, scopes };
    },
  };
}

export async function clientFor(account: GhAccount, getAuthHeader: (id: number) => Promise<string>): Promise<GhClient> {
  const authHeader = await getAuthHeader(account.id);
  return createClient({ authHeader, host: account.host });
}
