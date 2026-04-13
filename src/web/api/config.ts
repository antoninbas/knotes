import { Hono } from "hono";
import { embed, hasEmbedModelChanged } from "../../core/search.ts";

export const configApi = new Hono();

// Notify the server that configuration has changed.
// The server checks what changed and reacts accordingly
// (e.g. re-embed if the embed model was updated).
configApi.post("/notify", async (c) => {
  const actions: string[] = [];

  try {
    if (await hasEmbedModelChanged()) {
      // Fire-and-forget — don't block the CLI waiting for a full re-embed
      embed({ force: true, trigger: "on-demand" }).catch((err) => {
        console.error("Re-embed after model change failed:", err);
      });
      actions.push("reembed");
    }

    return c.json({ ok: true, actions });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
