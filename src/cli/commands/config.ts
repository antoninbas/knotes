import type { Command } from "commander";
import { ensureHome, getConfig, getConfigAsJson, applyConfigFromJson, getModelDefaults } from "../../core/config.ts";
import { isServerAlive } from "../../core/db.ts";
import { notifyEmbedModelChanged } from "../../core/client.ts";
import { openInEditor } from "../editor.ts";
import { tmpdir } from "os";
import { join } from "path";
import { unlink } from "fs/promises";

async function notifyServerIfModelChanged(changedKeys: string[]): Promise<void> {
  if (!changedKeys.includes("embedModel")) return;
  if (!isServerAlive()) return;
  try {
    const result = await notifyEmbedModelChanged();
    if (result.reembedTriggered) {
      console.log("Embed model changed — re-embedding triggered on the server.");
    }
  } catch {
    // Server notification is best-effort
  }
}

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("View and edit configuration");

  config
    .command("show")
    .description("Show current configuration")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      await ensureHome();
      const cfg = getConfigAsJson();
      if (opts.json) {
        console.log(JSON.stringify(cfg, null, 2));
      } else {
        const modelKeys = ["embedModel", "queryExpansionModel", "rerankModel"];
        const defaults = await getModelDefaults();
        for (const [key, value] of Object.entries(cfg)) {
          if (modelKeys.includes(key) && !value) {
            const defaultVal = defaults[key as keyof typeof defaults];
            console.log(`${key}: (default) ${defaultVal}`);
          } else {
            console.log(`${key}: ${value}`);
          }
        }
      }
    });

  config
    .command("edit")
    .description("Edit configuration in your editor")
    .action(async () => {
      await ensureHome();
      const cfg = getConfigAsJson();
      const tempFile = join(tmpdir(), `knotes-config-${Date.now()}.json`);
      await Bun.write(tempFile, JSON.stringify(cfg, null, 2) + "\n");

      const ok = await openInEditor(tempFile);
      if (!ok) {
        console.error("Editor exited with error");
        await unlink(tempFile).catch(() => {});
        process.exit(1);
      }

      const content = await Bun.file(tempFile).text();
      await unlink(tempFile).catch(() => {});

      try {
        const newCfg = JSON.parse(content);
        await applyConfigFromJson(newCfg);
        console.log("Configuration updated.");
        await notifyServerIfModelChanged(Object.keys(newCfg));
      } catch (err: any) {
        console.error(`Invalid JSON: ${err.message}`);
        process.exit(1);
      }
    });

  config
    .command("set")
    .description("Set a configuration value")
    .argument("<key>", "Configuration key")
    .argument("<value>", "Configuration value")
    .action(async (key: string, value: string) => {
      await ensureHome();
      const validKeys = ["editor", "webPort", "theme", "embedInterval", "serverless", "embedModel", "queryExpansionModel", "rerankModel"];
      if (!validKeys.includes(key)) {
        console.error(`Unknown config key: ${key}`);
        console.error(`Valid keys: ${validKeys.join(", ")}`);
        process.exit(1);
      }

      // Validate specific keys
      if (key === "webPort" || key === "embedInterval") {
        const num = parseInt(value, 10);
        if (isNaN(num)) {
          console.error(`${key} must be a number`);
          process.exit(1);
        }
      }
      if (key === "theme" && !["light", "dark", "system"].includes(value)) {
        console.error("theme must be one of: light, dark, system");
        process.exit(1);
      }
      if (key === "serverless" && !["true", "false"].includes(value)) {
        console.error("serverless must be true or false");
        process.exit(1);
      }

      await applyConfigFromJson({ [key]: key === "serverless" ? value === "true" : value });
      console.log(`${key} = ${value}`);
      await notifyServerIfModelChanged([key]);
    });

  config
    .command("get")
    .description("Get a configuration value")
    .argument("<key>", "Configuration key")
    .action(async (key: string) => {
      await ensureHome();
      const cfg = getConfigAsJson();
      if (key in cfg) {
        console.log(cfg[key]);
      } else {
        console.error(`Unknown config key: ${key}`);
        process.exit(1);
      }
    });
}
