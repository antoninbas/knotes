import type { Command } from "commander";
import { homedir, platform } from "os";
import { join } from "path";
import { mkdir } from "fs/promises";

const SERVICE_NAME = "com.knotes.server";
const SYSTEMD_UNIT = "knotes.service";

function getPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${SERVICE_NAME}.plist`);
}

function getSystemdPath(): string {
  return join(homedir(), ".config", "systemd", "user", SYSTEMD_UNIT);
}

function findBinary(): string {
  // Prefer the binary in PATH (e.g. from Homebrew)
  const execPath = process.execPath;
  // If running via bun, try to find a compiled knotes binary
  if (execPath.endsWith("bun") || execPath.endsWith("bun.exe")) {
    // Check common locations
    const candidates = [
      "/usr/local/bin/knotes",
      "/opt/homebrew/bin/knotes",
      join(homedir(), ".local", "bin", "knotes"),
    ];
    for (const c of candidates) {
      if (Bun.file(c).size > 0) return c;
    }
    // Fall back to bun run
    return `${execPath} run ${join(import.meta.dir, "../../main.ts")}`;
  }
  return execPath;
}

function generatePlist(opts: { port?: number; home?: string }): string {
  const binary = findBinary();
  const args = binary.includes(" ")
    ? binary.split(" ").map((a) => `    <string>${a}</string>`)
    : [`    <string>${binary}</string>`];
  args.push("    <string>server</string>");
  if (opts.port) {
    args.push("    <string>--port</string>");
    args.push(`    <string>${opts.port}</string>`);
  }

  const env: string[] = [];
  if (opts.home) {
    env.push(`    <key>KNOTES_HOME</key>`);
    env.push(`    <string>${opts.home}</string>`);
  }

  const envBlock =
    env.length > 0
      ? `  <key>EnvironmentVariables</key>
  <dict>
${env.join("\n")}
  </dict>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array>
${args.join("\n")}
  </array>
${envBlock}
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(homedir(), "Library", "Logs", "knotes.log")}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), "Library", "Logs", "knotes.log")}</string>
</dict>
</plist>`;
}

function generateSystemdUnit(opts: { port?: number; home?: string }): string {
  const binary = findBinary();
  const cmd = binary.includes(" ") ? binary : binary;
  let execStart = `${cmd} server`;
  if (opts.port) {
    execStart += ` --port ${opts.port}`;
  }

  const env: string[] = [];
  if (opts.home) {
    env.push(`Environment=KNOTES_HOME=${opts.home}`);
  }

  return `[Unit]
Description=Knotes server
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=on-failure
RestartSec=5
${env.join("\n")}

[Install]
WantedBy=default.target`;
}

export function registerServiceCommand(program: Command): void {
  const svc = program
    .command("service")
    .description("Manage the Knotes background service");

  svc
    .command("install")
    .description("Install and start the Knotes server as a background service")
    .option("-p, --port <port>", "Server port")
    .option("--home <path>", "KNOTES_HOME directory")
    .action(async (opts) => {
      const os = platform();
      if (os === "darwin") {
        await installLaunchd(opts);
      } else if (os === "linux") {
        await installSystemd(opts);
      } else {
        console.error(`Unsupported platform: ${os}`);
        process.exit(1);
      }
    });

  svc
    .command("uninstall")
    .description("Stop and remove the Knotes background service")
    .action(async () => {
      const os = platform();
      if (os === "darwin") {
        await uninstallLaunchd();
      } else if (os === "linux") {
        await uninstallSystemd();
      } else {
        console.error(`Unsupported platform: ${os}`);
        process.exit(1);
      }
    });

  svc
    .command("status")
    .description("Show service status")
    .action(async () => {
      const os = platform();
      if (os === "darwin") {
        await statusLaunchd();
      } else if (os === "linux") {
        await statusSystemd();
      } else {
        console.error(`Unsupported platform: ${os}`);
        process.exit(1);
      }
    });

  svc
    .command("logs")
    .description("Show service logs")
    .option("-f, --follow", "Follow log output")
    .option("-n, --lines <n>", "Number of lines to show", "50")
    .action(async (opts) => {
      const os = platform();
      if (os === "darwin") {
        await logsLaunchd(opts);
      } else if (os === "linux") {
        await logsSystemd(opts);
      } else {
        console.error(`Unsupported platform: ${os}`);
        process.exit(1);
      }
    });
}

// ─── macOS (launchd) ────────────────────────────────────────────

async function installLaunchd(opts: { port?: number; home?: string }) {
  const plistPath = getPlistPath();

  // Check if already installed
  if (await Bun.file(plistPath).exists()) {
    console.error("Service is already installed. Run `knotes service uninstall` first.");
    process.exit(1);
  }

  const plist = generatePlist(opts);
  await mkdir(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  await Bun.write(plistPath, plist);

  // Load the service
  const load = Bun.spawnSync(["launchctl", "load", plistPath]);
  if (load.exitCode !== 0) {
    console.error("Failed to load service:", new TextDecoder().decode(load.stderr));
    process.exit(1);
  }

  console.log("Service installed and started.");
  console.log(`  Plist: ${plistPath}`);
  console.log(`  Logs:  ~/Library/Logs/knotes.log`);
  if (opts.home) {
    console.log("");
    console.log(`Note: You set KNOTES_HOME=${opts.home} for the service.`);
    console.log("To use the CLI with the same data, add this to your shell profile:");
    console.log(`  export KNOTES_HOME=${opts.home}`);
  }
}

async function uninstallLaunchd() {
  const plistPath = getPlistPath();
  if (!(await Bun.file(plistPath).exists())) {
    console.error("Service is not installed.");
    process.exit(1);
  }

  Bun.spawnSync(["launchctl", "unload", plistPath]);
  const { unlink } = await import("fs/promises");
  await unlink(plistPath);
  console.log("Service stopped and removed.");
}

async function statusLaunchd() {
  const result = Bun.spawnSync(["launchctl", "list", SERVICE_NAME]);
  if (result.exitCode !== 0) {
    console.log("Service is not running.");
  } else {
    const output = new TextDecoder().decode(result.stdout);
    console.log(output);
  }
}

async function logsLaunchd(opts: { follow?: boolean; lines: string }) {
  const logPath = join(homedir(), "Library", "Logs", "knotes.log");
  if (!(await Bun.file(logPath).exists())) {
    console.log("No logs found.");
    return;
  }

  const args = opts.follow
    ? ["tail", "-f", "-n", opts.lines, logPath]
    : ["tail", "-n", opts.lines, logPath];
  const proc = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
  await proc.exited;
}

// ─── Linux (systemd) ────────────────────────────────────────────

async function installSystemd(opts: { port?: number; home?: string }) {
  const unitPath = getSystemdPath();

  if (await Bun.file(unitPath).exists()) {
    console.error("Service is already installed. Run `knotes service uninstall` first.");
    process.exit(1);
  }

  const unit = generateSystemdUnit(opts);
  await mkdir(join(homedir(), ".config", "systemd", "user"), { recursive: true });
  await Bun.write(unitPath, unit);

  // Reload systemd and enable+start the service
  Bun.spawnSync(["systemctl", "--user", "daemon-reload"]);
  const enable = Bun.spawnSync(["systemctl", "--user", "enable", "--now", SYSTEMD_UNIT]);
  if (enable.exitCode !== 0) {
    console.error("Failed to enable service:", new TextDecoder().decode(enable.stderr));
    process.exit(1);
  }

  console.log("Service installed and started.");
  console.log(`  Unit: ${unitPath}`);
  console.log(`  Logs: journalctl --user -u ${SYSTEMD_UNIT}`);
  if (opts.home) {
    console.log("");
    console.log(`Note: You set KNOTES_HOME=${opts.home} for the service.`);
    console.log("To use the CLI with the same data, add this to your shell profile:");
    console.log(`  export KNOTES_HOME=${opts.home}`);
  }
}

async function uninstallSystemd() {
  const unitPath = getSystemdPath();
  if (!(await Bun.file(unitPath).exists())) {
    console.error("Service is not installed.");
    process.exit(1);
  }

  Bun.spawnSync(["systemctl", "--user", "disable", "--now", SYSTEMD_UNIT]);
  const { unlink } = await import("fs/promises");
  await unlink(unitPath);
  Bun.spawnSync(["systemctl", "--user", "daemon-reload"]);
  console.log("Service stopped and removed.");
}

async function statusSystemd() {
  const proc = Bun.spawn(["systemctl", "--user", "status", SYSTEMD_UNIT], {
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
}

async function logsSystemd(opts: { follow?: boolean; lines: string }) {
  const args = ["journalctl", "--user", "-u", SYSTEMD_UNIT, "-n", opts.lines, "--no-pager"];
  if (opts.follow) args.push("-f");
  const proc = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
  await proc.exited;
}
