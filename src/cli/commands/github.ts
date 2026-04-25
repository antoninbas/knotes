import type { Command } from "commander";
import { platform } from "node:os";
import { execSync } from "node:child_process";
import { ensureHome, getConfig } from "../../core/config.ts";
import { getJobs } from "../../core/db.ts";
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
import { loginDevice } from "../../core/github/auth.ts";
import type { GhBodyMode, GhMonitor } from "../../core/github/types.ts";

interface BodySpec {
  mode: GhBodyMode;
  maxChars: number | null;
}

function parseBodySpec(value: string): BodySpec {
  const v = value.trim().toLowerCase();
  if (v === "title") return { mode: "title", maxChars: null };
  if (v === "full") return { mode: "full", maxChars: null };
  if (v === "first-paragraph" || v === "first_paragraph") {
    return { mode: "first_paragraph", maxChars: null };
  }
  const m = v.match(/^first-chars:(\d+)$/) || v.match(/^first_chars:(\d+)$/);
  if (m) {
    const n = parseInt(m[1]!, 10);
    if (n <= 0) throw new Error("--body first-chars:N requires N > 0");
    return { mode: "first_chars", maxChars: n };
  }
  throw new Error(
    `Unknown --body value: ${value}. Valid: title, full, first-paragraph, first-chars:N`
  );
}

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
    .option("--method <method>", "Authentication method: pat | gh | device", "pat")
    .option("--token <token>", "PAT (when --method pat)")
    .option(
      "--client-id <id>",
      "OAuth App client_id (--method device). Required for GHES; required for github.com until knotes ships a built-in App."
    )
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
        const acct = await loginDevice(host, { clientId: opts.clientId as string | undefined });
        console.log(`Authenticated as ${acct.login} on ${acct.host} (method: device)`);
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
    .option(
      "--body <spec>",
      "How much of each PR/issue body to include: title | full | first-paragraph | first-chars:N",
      "title"
    )
    .action(async (logPath: string, opts) => {
      const { host, login } = parseAccountSpec(opts.account as string);
      const body = parseBodySpec(opts.body as string);
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
        bodyMode: body.mode,
        bodyMaxChars: body.maxChars,
      });
      console.log(`Created connection ${conn.id} for ${logPath} (since ${conn.since}, body=${body.mode}${body.maxChars ? `:${body.maxChars}` : ""})`);
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
        const body = `body=${c.bodyMode}${c.bodyMaxChars ? `:${c.bodyMaxChars}` : ""}`;
        console.log(
          `${c.id}\t${c.logPath}\t${acct}\tmonitors=${monitors}\tsince=${c.since}\t${body}${filters ? "\t" + filters : ""}${last}`
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
    .command("status")
    .description("Show recent GitHub sync jobs and their results")
    .option("--limit <n>", "Max jobs to show", "10")
    .action(async (opts) => {
      const limit = parseInt(opts.limit, 10);
      const { jobs } = getJobs({ pageSize: limit, type: "github:sync" });
      if (jobs.length === 0) {
        console.log("No GitHub sync jobs recorded.");
        return;
      }
      for (const j of jobs) {
        const meta = j.metadata || "";
        const err = j.error ? ` error=${j.error}` : "";
        const dur = j.duration_ms !== null ? ` (${j.duration_ms}ms)` : "";
        console.log(`[${j.started_at}] ${j.type} ${j.status}${dur} ${meta}${err}`);
      }
    });

  gh
    .command("cron-install")
    .description("Print a snippet to schedule periodic GitHub sync (cron / launchd / systemd timer)")
    .option("--interval <minutes>", "Sync frequency in minutes", "10")
    .action((opts) => {
      const minutes = parseInt(opts.interval, 10);
      if (Number.isNaN(minutes) || minutes < 1) {
        console.error(`Invalid --interval: ${opts.interval}`);
        process.exit(1);
      }
      const knotesPath = (() => {
        try {
          return execSync("command -v knotes", { encoding: "utf-8" }).trim() || "knotes";
        } catch {
          return "knotes";
        }
      })();
      const os = platform();
      console.log(`# Run \`knotes github sync\` every ${minutes} minute(s).`);
      console.log(`# Knotes binary: ${knotesPath}`);
      console.log("");
      if (os === "darwin") {
        console.log("# macOS — launchd (recommended). Save as");
        console.log(`#   ~/Library/LaunchAgents/com.knotes.github-sync.plist`);
        console.log("# then: launchctl load ~/Library/LaunchAgents/com.knotes.github-sync.plist");
        console.log("");
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`);
        console.log(`<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`);
        console.log(`<plist version="1.0">`);
        console.log(`  <dict>`);
        console.log(`    <key>Label</key><string>com.knotes.github-sync</string>`);
        console.log(`    <key>ProgramArguments</key>`);
        console.log(`    <array>`);
        console.log(`      <string>${knotesPath}</string>`);
        console.log(`      <string>github</string>`);
        console.log(`      <string>sync</string>`);
        console.log(`    </array>`);
        console.log(`    <key>StartInterval</key><integer>${minutes * 60}</integer>`);
        console.log(`    <key>RunAtLoad</key><true/>`);
        console.log(`  </dict>`);
        console.log(`</plist>`);
        console.log("");
        console.log("# Or, for cron (less idiomatic on macOS):");
      } else if (os === "linux") {
        console.log(`# Linux — systemd user timer (recommended). Create:`);
        console.log(`#   ~/.config/systemd/user/knotes-github-sync.service`);
        console.log(`#   ~/.config/systemd/user/knotes-github-sync.timer`);
        console.log("# then: systemctl --user enable --now knotes-github-sync.timer");
        console.log("");
        console.log("# knotes-github-sync.service:");
        console.log("[Unit]");
        console.log("Description=Knotes GitHub activity sync");
        console.log("[Service]");
        console.log("Type=oneshot");
        console.log(`ExecStart=${knotesPath} github sync`);
        console.log("");
        console.log("# knotes-github-sync.timer:");
        console.log("[Unit]");
        console.log("Description=Run knotes GitHub sync periodically");
        console.log("[Timer]");
        console.log(`OnUnitActiveSec=${minutes}min`);
        console.log("OnBootSec=1min");
        console.log("[Install]");
        console.log("WantedBy=timers.target");
        console.log("");
        console.log("# Or, for cron:");
      }
      console.log(`*/${minutes} * * * * ${knotesPath} github sync >/dev/null 2>&1`);
      console.log("");
      console.log(`# Note: in server mode the running knotes server already syncs every ${getConfig().githubSyncInterval}s.`);
      console.log(`# This snippet is intended for serverless mode or as a backstop.`);
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
