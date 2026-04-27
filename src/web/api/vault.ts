import { Hono } from "hono";
import { z } from "zod";
import { unlock, lock, setupEncryption, isLocked, isEncrypted, vaultExists } from "../../core/vault.ts";

const UnlockSchema = z.object({
  passphrase: z.string().min(1),
});

const EncryptSchema = z.object({
  passphrase: z.string().min(1),
});

export const vaultApi = new Hono();

vaultApi.post("/unlock", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = UnlockSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      400
    );
  }
  try {
    unlock(parsed.data.passphrase);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

vaultApi.get("/lock-status", (c) => {
  return c.json({ locked: isLocked(), encrypted: isEncrypted(), vaultExists: vaultExists() });
});

vaultApi.post("/lock", (c) => {
  lock();
  return c.json({ ok: true });
});

vaultApi.post("/encrypt", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = EncryptSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      400
    );
  }
  try {
    setupEncryption(parsed.data.passphrase);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});
