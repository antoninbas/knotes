import { spawn } from "node:child_process";
import { getConfig } from "../core/config.ts";

/**
 * Open a file in the user's preferred editor and wait for it to close.
 * Returns true if the editor exited successfully.
 */
export async function openInEditor(filePath: string): Promise<boolean> {
  const config = getConfig();
  const editor = config.editor;

  // Split editor command in case it has args (e.g. "code --wait")
  const parts = editor.split(/\s+/);
  const cmd = parts[0]!;
  const args = [...parts.slice(1), filePath];

  const proc = spawn(cmd, args, {
    stdio: ["inherit", "inherit", "inherit"],
  });

  const exitCode = await new Promise<number | null>((resolve) =>
    proc.on("close", resolve)
  );
  return exitCode === 0;
}
