import { createSignal, createEffect, Show } from "solid-js";
import { vaultApi } from "../lib/api.ts";

export default function VaultStatus() {
  const [status, setStatus] = createSignal<{ encrypted: boolean; locked: boolean } | null>(null);
  const [showModal, setShowModal] = createSignal(false);
  const [passphrase, setPassphrase] = createSignal("");
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);

  async function fetchStatus() {
    try {
      const s = await vaultApi.lockStatus();
      setStatus(s);
    } catch {
      setStatus(null);
    }
  }

  createEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  });

  async function handleUnlock() {
    setError("");
    setLoading(true);
    try {
      await vaultApi.unlock(passphrase());
      setShowModal(false);
      setPassphrase("");
      await fetchStatus();
    } catch (err: any) {
      setError(err.message || "Failed to unlock");
    } finally {
      setLoading(false);
    }
  }

  async function handleLock() {
    try {
      await vaultApi.lock();
      await fetchStatus();
    } catch {
      // ignore
    }
  }

  const label = () => {
    const s = status();
    if (!s) return "";
    if (!s.encrypted) return "PLAINTEXT";
    if (s.locked) return "LOCKED";
    return "UNLOCKED";
  };

  return (
    <Show when={status()?.encrypted}>
      <button
        onClick={() => {
          if (status()?.locked) {
            setShowModal(true);
            setError("");
          } else {
            handleLock();
          }
        }}
        class="px-2 sm:px-3 py-1 text-sm rounded transition-colors cursor-pointer flex items-center gap-1.5"
        style={{
          background: "var(--color-bg-surface)",
          color: status()?.locked ? "var(--color-danger)" : "var(--color-text-secondary)",
        }}
        title={status()?.locked ? "Vault is locked — click to unlock" : "Vault is unlocked — click to lock"}
      >
        <span style={{ "font-size": "1rem" }}>{status()?.locked ? "🔒" : "🔓"}</span>
        <span class="hidden sm:inline" style={{ width: "5.5rem", display: "inline-block", "text-align": "center" }}>
          {label()}
        </span>
      </button>

      <Show when={showModal()}>
        <div
          class="fixed inset-0 flex items-center justify-center z-50 px-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowModal(false)}
        >
          <div
            class="rounded-lg shadow-xl p-6 max-w-sm w-full"
            style={{ background: "var(--color-bg-secondary)", color: "var(--color-text-primary)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 class="text-lg font-bold mb-4">Unlock Vault</h2>
            <p class="text-sm mb-4" style={{ color: "var(--color-text-secondary)" }}>
              The credential vault is locked. Enter your passphrase to unlock it.
            </p>
            <input
              type="password"
              placeholder="Passphrase"
              value={passphrase()}
              onInput={(e) => setPassphrase(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              class="w-full px-3 py-2 text-sm rounded border outline-none mb-3"
              style={{
                "background-color": "var(--color-bg-primary)",
                "border-color": "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
            <Show when={error()}>
              <p class="text-xs mb-3" style={{ color: "var(--color-danger)" }}>{error()}</p>
            </Show>
            <div class="flex gap-2">
              <button
                onClick={handleUnlock}
                disabled={loading() || !passphrase()}
                class="flex-1 px-4 py-1.5 text-sm rounded cursor-pointer"
                style={{ background: "var(--color-accent)", color: "#fff", opacity: loading() || !passphrase() ? 0.6 : 1 }}
              >
                {loading() ? "Unlocking..." : "Unlock"}
              </button>
              <button
                onClick={() => setShowModal(false)}
                class="flex-1 px-4 py-1.5 text-sm rounded cursor-pointer"
                style={{ background: "var(--color-bg-surface)", color: "var(--color-text-secondary)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </Show>
    </Show>
  );
}
