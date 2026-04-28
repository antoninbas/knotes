export type GhMonitor =
  | "opened_prs"
  | "merged_prs"
  | "opened_issues"
  | "pr_reviews";

export type GhAuthMethod = "device" | "pat" | "gh-cli";

export type GhBodyMode = "title" | "full" | "first_paragraph" | "first_chars";

export interface GhAccount {
  id: number;
  host: string;
  login: string;
  userNodeId: string;
  authMethod: GhAuthMethod;
  tokenScopes: string | null;
  /** OAuth App client_id used to authenticate this account (device flow only). */
  clientId: string | null;
  /** True when the token has been revoked (401 received during sync). */
  needsReauth: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface GhConnection {
  id: number;
  logPath: string;
  accountId: number;
  monitors: GhMonitor[];
  includeOrgs: string[] | null;
  excludeOrgs: string[] | null;
  includeRepos: string[] | null;
  excludeRepos: string[] | null;
  since: string;
  lastSyncedAt: string | null;
  enabled: boolean;
  /** How much of the PR/issue body to include in each rendered entry. */
  bodyMode: GhBodyMode;
  /** Character cap when bodyMode is "first_chars". */
  bodyMaxChars: number | null;
  createdAt: string;
}

export interface GhSyncedEvent {
  connectionId: number;
  eventId: string;
  entryId: string;
  timestamp: string;
  stateHash: string;
  url: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GhSyncResult {
  connectionId: number;
  logPath: string;
  pulled: number;
  written: number;
  updated: number;
  skipped: number;
  rateLimited: boolean;
  authError?: boolean;
  nextRetryAt?: string;
}
