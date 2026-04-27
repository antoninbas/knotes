import { createSignal, createEffect, Show } from "solid-js";
import { vaultApi } from "../lib/api.ts";

export default function VaultStatus() {
  const [status, setStatus] = createSignal<{ encrypted: boolean; locked: boolean; vaultExists: boolean } | null>(null);
  const [showUnlockModal, setShowUnlockModal] = createSignal(false);
  const [showEncryptModal, setShowEncryptModal] = createSignal(false);
  const [passphrase, setPassphrase] = createSignal("");
  const [confirmPassphrase, setConfirmPassphrase] = createSignal("");
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
      setShowUnlockModal(false);
      setPassphrase("");
      await fetchStatus();
    } catch (err: any) {
      setError(err.message || "Failed to unlock");
    } finally {
      setLoading(false);
    }
  }

  async function handleEncrypt() {
    setError("");
    if (passphrase() !== confirmPassphrase()) {
      setError("Passphrases do not match");
      return;
    }
    setLoading(true);
    try {
      await vaultApi.encrypt(passphrase());
      setShowEncryptModal(false);
      setPassphrase("");
      setConfirmPassphrase("");
      await fetchStatus();
    } catch (err: any) {
      setError(err.message || "Failed to encrypt");
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

  const icon = () => {
    const s = status();
    if (!s) return "";
    if (!s.encrypted) return "⚠️";
    if (s.locked) return "🔒";
    return "🔓";
  };

  const color = () => {
    const s = status();
    if (!s) return "var(--color-text-secondary)";
    if (!s.encrypted) return "var(--color-warning, #f59e0b)";
    if (s.locked) return "var(--color-danger)";
    return "var(--color-text-secondary)";
  };

  return (
    <Show when={status()?.vaultExists}>
      <button
        onClick={() => {
          const s = status();
          if (!s) return;
          if (!s.encrypted) {
            setShowEncryptModal(true);
            setError("");
          } else if (s.locked) {
            setShowUnlockModal(true);
            setError("");
          } else {
            handleLock();
          }
        }}
        class="px-2 sm:px-3 py-1 text-sm rounded transition-colors cursor-pointer flex items-center gap-1.5"
        style={{
          background: "var(--color-bg-surface)",
          color: color(),
        }}
        title={
          !status()?.encrypted
            ? "Vault is plaintext — click to encrypt"
            : status()?.locked
              ? "Vault is locked — click to unlock"
              : "Vault is unlocked — click to lock"
        }
      >
        <span style={{ "font-size": "1rem" }}>{icon()}</span>
        <span class="hidden sm:inline" style={{ width: "5.5rem", display: "inline-block", "text-align": "center" }}>
          {label()}
        </span>
      </button>

      {/* Unlock modal */}
      <Show when={showUnlockModal()}>
        <div
          class="fixed inset-0 flex items-center justify-center z-50 px-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowUnlockModal(false)}
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
                onClick={() => setShowUnlockModal(false)}
                class="flex-1 px-4 py-1.5 text-sm rounded cursor-pointer"
                style={{ background: "var(--color-bg-surface)", color: "var(--color-text-secondary)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* Encrypt modal */}
      <Show when={showEncryptModal()}>
        <div
          class="fixed inset-0 flex items-center justify-center z-50 px-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowEncryptModal(false)}
        >
          <div
            class="rounded-lg shadow-xl p-6 max-w-sm w-full"
            style={{ background: "var(--color-bg-secondary)", color: "var(--color-text-primary)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 class="text-lg font-bold mb-4">Encrypt Vault</h2>
            <p class="text-sm mb-4" style={{ color: "var(--color-text-secondary)" }}>
              Protect your stored credentials with a passphrase.
            </p>
            <input
              type="password"
              placeholder="Passphrase"
              value={passphrase()}
              onInput={(e) => setPassphrase(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && handleEncrypt()}
              class="w-full px-3 py-2 text-sm rounded border outline-none mb-2"
              style={{
                "background-color": "var(--color-bg-primary)",
                "border-color": "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
            <input
              type="password"
              placeholder="Confirm passphrase"
              value={confirmPassphrase()}
              onInput={(e) => setConfirmPassphrase(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && handleEncrypt()}
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
                onClick={handleEncrypt}
                disabled={loading() || !passphrase() || !confirmPassphrase()}
                class="flex-1 px-4 py-1.5 text-sm rounded cursor-pointer"
                style={{ background: "var(--color-accent)", color: "#fff", opacity: loading() || !passphrase() || !confirmPassphrase() ? 0.6 : 1 }}
              >
                {loading() ? "Encrypting..." : "Encrypt"}
              </button>
              <button
                onClick={() => setShowEncryptModal(false)}
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
