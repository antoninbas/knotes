import type { Command } from "commander";
import { ensureHome } from "../../core/config.ts";
import {
  listGithubAccounts,
  loginGithubPat,
  loginGithubGhCli,
  logoutGithub,
  listGithubConnections,
  addGithubConnection,
  removeGithubConnection,
  syncGithub,
} from "../../core/router.ts";
import type { GhMonitor } from "../../core/github/types.ts";

const MONITOR_ALIASES: Record<string, GhMonitor> = {
  "opened-prs": "opened_prs",
  "opened_prs": "opened_prs",
  "merged-prs": "merged_prs",
  "merged_prs": "merged_prs",
  issues: "opened_issues",
  "opened-issues": "opened_issues",
  "opened_issues": "opened_issues",
  reviews: "pr_reviews",
  "pr-reviews": "pr_reviews",
  "pr_reviews": "pr_reviews",
};

function parseMonitors(value: string): GhMonitor[] {
  const tokens = value
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  const out: GhMonitor[] = [];
  for (const t of tokens) {
    const m = MONITOR_ALIASES[t];
    if (!m) {
      throw new Error(
        `Unknown monitor: ${t}. Valid: opened-prs, merged-prs, issues, reviews`
      );
    }
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

function collect(value: string, prev: string[]): string[] {
  return prev.concat([value]);
}

function parseAccountSpec(spec: string): { host: string; login: string } {
  const idx = spec.indexOf(":");
  if (idx <= 0 || idx === spec.length - 1) {
    throw new Error(`Invalid --account format. Expected <host>:<login>, got: ${spec}`);
  }
  return { host: spec.slice(0, idx), login: spec.slice(idx + 1) };
}

async function readPasswordFromStdin(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    const onData = (chunk: string) => {
      const newlineIdx = chunk.indexOf("\n");
      if (newlineIdx >= 0) {
        data += chunk.slice(0, newlineIdx);
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        resolve(data.trim());
      } else {
        data += chunk;
      }
    };
    process.stdin.on("data", onData);
    process.stdin.resume();
  });
}

export function registerGithubCommands(program: Command): void {
  const gh = program.command("github").description("Connect log journals to GitHub activity");

  // --- auth ---

  const auth = gh.command("auth").description("Manage GitHub authentication");

  auth
    .command("login")
    .description("Authenticate with a GitHub host")
    .option("--host <host>", "GitHub host (e.g. github.com or ghe.example.com)", "github.com")
    .option("--method <method>", "Authentication method: pat | gh (device flow coming in milestone 6)", "pat")
    .option("--token <token>", "PAT (when --method pat)")
    .action(async (opts) => {
      await ensureHome();
      const host = opts.host as string;
      const method = opts.method as string;

      if (method === "pat") {
        let token = opts.token as string | undefined;
        if (!token) {
          if (!process.stdin.isTTY) {
            console.error("No --token provided and stdin is not a TTY. Pass --token <PAT> or run interactively.");
            process.exit(1);
          }
          token = await readPasswordFromStdin(`PAT for ${host}: `);
          if (!token) {
            console.error("Empty token, aborting.");
            process.exit(1);
          }
        }
        const acct = await loginGithubPat(host, token);
        console.log(`Authenticated as ${acct.login} on ${acct.host} (method: pat)`);
      } else if (method === "gh" || method === "gh-cli") {
        const acct = await loginGithubGhCli(host);
        console.log(`Authenticated as ${acct.login} on ${acct.host} (method: gh-cli)`);
      } else if (method === "device") {
        console.error("Device flow is not yet implemented (milestone 6). Use --method pat or --method gh.");
        process.exit(1);
      } else {
        console.error(`Unknown method: ${method}. Use pat or gh.`);
        process.exit(1);
      }
    });

  auth
    .command("list")
    .description("List authenticated GitHub accounts")
    .action(async () => {
      const accounts = await listGithubAccounts();
      if (accounts.length === 0) {
        console.log("No GitHub accounts configured.");
        return;
      }
      for (const a of accounts) {
        const last = a.lastUsedAt ? ` last_used=${a.lastUsedAt}` : "";
        console.log(`${a.host}:${a.login} (method: ${a.authMethod})${last}`);
      }
    });

  auth
    .command("logout")
    .description("Remove an authenticated GitHub account")
    .argument("<host>", "GitHub host")
    .argument("<login>", "GitHub login (username)")
    .action(async (host: string, login: string) => {
      await logoutGithub(host, login);
      console.log(`Logged out: ${host}:${login}`);
    });

  // --- connections ---

  gh
    .command("connect")
    .description("Attach a GitHub connection to a log journal")
    .argument("<log-path>", "Logical path of the log journal (e.g. logs/work/activity)")
    .requiredOption("--account <host:login>", "Account spec in <host>:<login> form")
    .requiredOption("--monitor <list>", "Comma-separated: opened-prs,merged-prs,issues,reviews", parseMonitors)
    .option("--include-org <org>", "Include only this org (repeatable)", collect, [])
    .option("--exclude-org <org>", "Exclude this org (repeatable)", collect, [])
    .option("--include-repo <owner/repo>", "Include only this repo (repeatable)", collect, [])
    .option("--exclude-repo <owner/repo>", "Exclude this repo (repeatable)", collect, [])
    .option("--since <date>", "Backfill cutoff (ISO date or datetime). Default: now - 7d")
    .action(async (logPath: string, opts) => {
      const { host, login } = parseAccountSpec(opts.account as string);
      const conn = await addGithubConnection({
        logPath,
        host,
        login,
        monitors: opts.monitor as GhMonitor[],
        includeOrgs: (opts.includeOrg as string[]).length > 0 ? (opts.includeOrg as string[]) : undefined,
        excludeOrgs: (opts.excludeOrg as string[]).length > 0 ? (opts.excludeOrg as string[]) : undefined,
        includeRepos: (opts.includeRepo as string[]).length > 0 ? (opts.includeRepo as string[]) : undefined,
        excludeRepos: (opts.excludeRepo as string[]).length > 0 ? (opts.excludeRepo as string[]) : undefined,
        since: opts.since as string | undefined,
      });
      console.log(`Created connection ${conn.id} for ${logPath} (since ${conn.since})`);
    });

  gh
    .command("list")
    .description("List GitHub connections")
    .argument("[log-path]", "Filter by log journal path")
    .action(async (logPath?: string) => {
      const conns = await listGithubConnections(logPath);
      if (conns.length === 0) {
        console.log("No GitHub connections found.");
        return;
      }
      const accounts = await listGithubAccounts();
      const acctById = new Map(accounts.map((a) => [a.id, a]));
      for (const c of conns) {
        const a = acctById.get(c.accountId);
        const acct = a ? `${a.host}:${a.login}` : `account#${c.accountId}`;
        const monitors = c.monitors.join(",");
        const filters = [
          c.includeOrgs && `include-org=${c.includeOrgs.join("|")}`,
          c.excludeOrgs && `exclude-org=${c.excludeOrgs.join("|")}`,
          c.includeRepos && `include-repo=${c.includeRepos.join("|")}`,
          c.excludeRepos && `exclude-repo=${c.excludeRepos.join("|")}`,
        ].filter(Boolean).join(" ");
        const last = c.lastSyncedAt ? ` last_synced=${c.lastSyncedAt}` : "";
        console.log(
          `${c.id}\t${c.logPath}\t${acct}\tmonitors=${monitors}\tsince=${c.since}${filters ? "\t" + filters : ""}${last}`
        );
      }
    });

  gh
    .command("sync")
    .description("Pull GitHub activity now into the connected log journal(s)")
    .argument("[log-path]", "Sync only this journal")
    .option("--connection <id>", "Sync only this connection id")
    .action(async (logPath: string | undefined, opts) => {
      const connectionId = opts.connection ? parseInt(opts.connection, 10) : undefined;
      if (opts.connection && Number.isNaN(connectionId)) {
        console.error(`Invalid --connection: ${opts.connection}`);
        process.exit(1);
      }
      const results = await syncGithub({ logPath, connectionId });
      if (results.length === 0) {
        console.log("No connections to sync.");
        return;
      }
      for (const r of results) {
        const tail = r.rateLimited
          ? ` (RATE LIMITED, retry after ${r.nextRetryAt ?? "unknown"})`
          : "";
        console.log(
          `connection ${r.connectionId} ${r.logPath}: pulled=${r.pulled} written=${r.written} updated=${r.updated} skipped=${r.skipped}${tail}`
        );
      }
    });

  gh
    .command("disconnect")
    .description("Remove a GitHub connection")
    .argument("<connection-id>", "Connection id")
    .action(async (idStr: string) => {
      const id = parseInt(idStr, 10);
      if (Number.isNaN(id)) {
        console.error(`Invalid connection id: ${idStr}`);
        process.exit(1);
      }
      await removeGithubConnection(id);
      console.log(`Disconnected ${id}`);
    });
}
