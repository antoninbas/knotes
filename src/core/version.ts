import { join } from "path";

let cachedVersion: string | null = null;

/**
 * Get the version string for the running instance.
 *
 * - Release build: "0.3.0"
 * - Dev build: "0.3.0-dev.2+gabc1234" (2 commits after v0.3.0, at commit abc1234)
 *
 * Resolution order:
 * 1. Git describe (if running from a git repo — dev mode)
 * 2. VERSION file (written by `make install`)
 * 3. package.json version (fallback)
 */
export function getVersion(): string {
  if (cachedVersion) return cachedVersion;

  // Try git describe first (dev mode — running from source in a git repo)
  cachedVersion = tryGitDescribe() ?? tryVersionFile() ?? tryPackageJson() ?? "unknown";
  return cachedVersion;
}

function tryGitDescribe(): string | null {
  try {
    const result = Bun.spawnSync(["git", "describe", "--tags", "--always"], {
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return null;
    const raw = new TextDecoder().decode(result.stdout).trim();
    return formatVersion(raw);
  } catch {
    return null;
  }
}

function tryVersionFile(): string | null {
  try {
    // VERSION file lives next to package.json in the install dir
    const versionPath = join(import.meta.dir, "../../VERSION");
    const file = Bun.file(versionPath);
    // Use a sync check — Bun.file().text() is async but we need sync here
    const result = Bun.spawnSync(["cat", versionPath], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) return null;
    const raw = new TextDecoder().decode(result.stdout).trim();
    return formatVersion(raw);
  } catch {
    return null;
  }
}

function tryPackageJson(): string | null {
  try {
    const pkgPath = join(import.meta.dir, "../../package.json");
    const result = Bun.spawnSync(["cat", pkgPath], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) return null;
    const pkg = JSON.parse(new TextDecoder().decode(result.stdout));
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Convert git describe output to semver with build metadata.
 *
 * Input examples:
 *   "v0.3.0"              → "0.3.0"
 *   "v0.3.0-2-gabc1234"   → "0.3.0-dev.2+gabc1234"
 *   "abc1234"              → "0.0.0+gabc1234" (no tags)
 */
function formatVersion(raw: string): string {
  // Exact tag match: v0.3.0 → 0.3.0
  const tagMatch = raw.match(/^v?(\d+\.\d+\.\d+)$/);
  if (tagMatch) return tagMatch[1]!;

  // Tag + commits: v0.3.0-2-gabc1234 → 0.3.0-dev.2+gabc1234
  const devMatch = raw.match(/^v?(\d+\.\d+\.\d+)-(\d+)-g([a-f0-9]+)$/);
  if (devMatch) return `${devMatch[1]}-dev.${devMatch[2]}+g${devMatch[3]}`;

  // No tag, just a commit hash
  const hashMatch = raw.match(/^[a-f0-9]+$/);
  if (hashMatch) return `0.0.0+g${raw}`;

  return raw;
}
