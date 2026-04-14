import { basename, extname } from "path";
import { tmpdir } from "os";
import { join } from "path";
import { unlink, readFile } from "fs/promises";
import { spawn } from "node:child_process";
import { createNote } from "./notes.ts";
import type { NoteResult } from "./types.ts";

/** Check if markitdown is available on the system. */
export async function checkMarkitdown(): Promise<boolean> {
  try {
    const proc = spawn("markitdown", ["--help"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exitCode = await new Promise<number | null>((resolve) =>
      proc.on("close", resolve)
    );
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Import an external document by converting it to markdown via markitdown.
 * Requires markitdown to be installed (`pip install 'markitdown[all]'`).
 */
export async function importDocument(
  filePath: string,
  options?: { to?: string }
): Promise<NoteResult> {
  const name = basename(filePath, extname(filePath));
  const targetPath = options?.to || `notes/imported/${name}`;
  const tempFile = join(tmpdir(), `knotes-import-${Date.now()}.md`);

  try {
    const proc = spawn("markitdown", [filePath, "-o", tempFile], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Collect stderr for error reporting
    const stderrChunks: Buffer[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const exitCode = await new Promise<number | null>((resolve) =>
      proc.on("close", resolve)
    );
    if (exitCode !== 0) {
      const stderr = Buffer.concat(stderrChunks).toString();
      throw new Error(
        `markitdown failed (exit ${exitCode}): ${stderr.trim() || "unknown error"}`
      );
    }

    const content = await readFile(tempFile, "utf-8");
    if (!content.trim()) {
      throw new Error(
        `markitdown produced empty output for: ${filePath}`
      );
    }

    return await createNote(targetPath, {
      title: name,
      content: content.trim(),
    });
  } finally {
    try {
      await unlink(tempFile);
    } catch {
      // Temp file may not exist if markitdown failed early
    }
  }
}
