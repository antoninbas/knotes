import { join } from "path";
import { homedir } from "os";
import { mkdir } from "fs/promises";
import { getConfigValue, setConfigValue, getAllConfig } from "./db.ts";
import type { KnotesConfig } from "./types.ts";

const DEFAULT_HOME = join(homedir(), ".knotes");

export function getHome(): string {
  return process.env["KNOTES_HOME"] || DEFAULT_HOME;
}

export function getConfig(): KnotesConfig {
  const home = getHome();

  return {
    home,
    editor: process.env["EDITOR"] || getConfigValue("editor") || "vi",
    webPort: parseInt(getConfigValue("webPort") || "7713", 10),
    theme: (getConfigValue("theme") as KnotesConfig["theme"]) || "system",
    embedInterval: parseInt(getConfigValue("embedInterval") || "300", 10),
    serverless: getConfigValue("serverless") === "true",
  };
}

export function resetConfigCache(): void {
  // No-op — config is read fresh from DB each time now.
  // Kept for test compatibility. Resets the DB connection instead.
  const { resetDb } = require("./db.ts");
  resetDb();
}

export async function saveConfig(
  updates: Partial<Omit<KnotesConfig, "home">>
): Promise<void> {
  if (updates.editor !== undefined) setConfigValue("editor", updates.editor);
  if (updates.webPort !== undefined) setConfigValue("webPort", String(updates.webPort));
  if (updates.theme !== undefined) setConfigValue("theme", updates.theme);
  if (updates.embedInterval !== undefined) setConfigValue("embedInterval", String(updates.embedInterval));
  if (updates.serverless !== undefined) setConfigValue("serverless", String(updates.serverless));
}

/**
 * Get config as a plain JSON object for export/editing.
 */
export function getConfigAsJson(): Record<string, any> {
  const config = getConfig();
  const { home, ...rest } = config;
  return rest;
}

/**
 * Apply config from a JSON object (as returned by getConfigAsJson).
 */
export async function applyConfigFromJson(json: Record<string, any>): Promise<void> {
  await saveConfig(json as Partial<Omit<KnotesConfig, "home">>);
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
