// Watchdog around the e2e server. Spawns the server in its own process
// group, then polls KNOTES_E2E_ANCHOR_PID once a second. If the anchor
// (the vitest process that spawned us) disappears, we tear the server
// down, even if our own SIGTERM never arrived.
//
// Anchor is passed explicitly via env because intermediate wrappers
// (npx, the tsx CLI) exit after spawning us, so process.ppid is unreliable.
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "../..");

const anchorPid = Number(process.env["KNOTES_E2E_ANCHOR_PID"]);
if (!Number.isInteger(anchorPid) || anchorPid <= 1) {
  console.error("supervisor: missing or invalid KNOTES_E2E_ANCHOR_PID");
  process.exit(2);
}

const tsxBin = join(PROJECT_ROOT, "node_modules/.bin/tsx");
const child = spawn(tsxBin, ["src/main.ts", "server", ...process.argv.slice(2)], {
  cwd: PROJECT_ROOT,
  stdio: "inherit",
  detached: true,
});

const childPid = child.pid;

function killGroup(sig: NodeJS.Signals): void {
  if (childPid == null) return;
  try { process.kill(-childPid, sig); } catch {}
}

let shuttingDown = false;
function shutdown(reason: string, code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(poll);
  console.error(`supervisor: ${reason}`);
  killGroup("SIGTERM");
  setTimeout(() => {
    killGroup("SIGKILL");
    setTimeout(() => process.exit(code), 200);
  }, 2000);
}

const poll = setInterval(() => {
  try {
    process.kill(anchorPid, 0);
  } catch {
    shutdown(`anchor pid ${anchorPid} gone`, 1);
  }
}, 1000);

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(sig, () => shutdown(`received ${sig}`));
}

child.on("exit", (code, signal) => {
  if (shuttingDown) return;
  clearInterval(poll);
  process.exit(code ?? (signal ? 1 : 0));
});
