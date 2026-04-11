import { join } from "path";
import { homedir } from "os";
import { mkdir } from "fs/promises";
import type { KnotesConfig } from "./types.ts";

const DEFAULT_HOME = join(homedir(), ".knotes");

let cachedConfig: KnotesConfig | null = null;

export function getHome(): string {
  return process.env["KNOTES_HOME"] || DEFAULT_HOME;
}

export function getConfig(): KnotesConfig {
  if (cachedConfig) return cachedConfig;

  const home = getHome();
  const settingsPath = join(home, ".config", "settings.json");

  let saved: Partial<KnotesConfig> = {};
  try {
    const file = Bun.file(settingsPath);
    // Synchronous check — settings file is tiny
    saved = JSON.parse(
      require("fs").readFileSync(settingsPath, "utf-8")
    ) as Partial<KnotesConfig>;
  } catch {
    // No settings file yet — use defaults
  }

  cachedConfig = {
    home,
    editor: process.env["EDITOR"] || saved.editor || "vi",
    webPort: saved.webPort || 3000,
    theme: saved.theme || "system",
  };

  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}

export async function saveConfig(
  updates: Partial<Omit<KnotesConfig, "home">>
): Promise<void> {
  const config = getConfig();
  const settingsDir = join(config.home, ".config");
  await mkdir(settingsDir, { recursive: true });

  const settingsPath = join(settingsDir, "settings.json");
  const merged = { ...config, ...updates };
  // Don't persist `home` — it comes from env
  const { home: _, ...toSave } = merged;
  await Bun.write(settingsPath, JSON.stringify(toSave, null, 2) + "\n");
  cachedConfig = null;
}

/** Ensure KNOTES_HOME directory structure exists. */
export async function ensureHome(): Promise<void> {
  const home = getHome();
  await Promise.all([
    mkdir(join(home, ".config"), { recursive: true }),
    mkdir(join(home, ".data"), { recursive: true }),
    mkdir(join(home, "notes"), { recursive: true }),
    mkdir(join(home, "logs"), { recursive: true }),
  ]);
}

/** Resolve a logical path (e.g. "notes/foo/bar") to an absolute .md file path. */
export function resolvePath(logicalPath: string): string {
  const home = getHome();
  const cleaned = logicalPath.replace(/\.md$/, "");
  return join(home, cleaned + ".md");
}

/** Convert an absolute file path back to a logical path. */
export function toLogicalPath(filePath: string): string {
  const home = getHome();
  return filePath.replace(home + "/", "").replace(/\.md$/, "");
}
