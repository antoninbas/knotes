import { basename, extname } from "path";
import { tmpdir } from "os";
import { join } from "path";
import { unlink } from "fs/promises";
import { createNote } from "./notes.ts";
import type { NoteResult } from "./types.ts";

/** Check if markitdown is available on the system. */
export async function checkMarkitdown(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["markitdown", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return proc.exitCode === 0;
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
    const proc = Bun.spawn(["markitdown", filePath, "-o", tempFile], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(
        `markitdown failed (exit ${exitCode}): ${stderr.trim() || "unknown error"}`
      );
    }

    const content = await Bun.file(tempFile).text();
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
