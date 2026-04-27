import { createSignal, createEffect, Show, onCleanup } from "solid-js";
import { vaultApi } from "../lib/api.ts";

export default function VaultStatus() {
  const [status, setStatus] = createSignal<{ encrypted: boolean; locked: boolean; vaultExists: boolean; entryCount: number } | null>(null);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [showUnlockModal, setShowUnlockModal] = createSignal(false);
  const [showEncryptModal, setShowEncryptModal] = createSignal(false);
  const [passphrase, setPassphrase] = createSignal("");
  const [confirmPassphrase, setConfirmPassphrase] = createSignal("");
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);

  let menuRef: HTMLDivElement | undefined;

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

  function handleClickOutside(e: MouseEvent) {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      setMenuOpen(false);
    }
  }

  function toggleMenu() {
    const willOpen = !menuOpen();
    setMenuOpen(willOpen);
    if (willOpen) {
      document.addEventListener("click", handleClickOutside, { once: true });
    }
  }

  onCleanup(() => {
    document.removeEventListener("click", handleClickOutside);
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

  const statusLabel = () => {
    const s = status();
    if (!s) return "Unknown";
    if (!s.encrypted) return "Plaintext";
    if (s.locked) return "Locked";
    return "Unlocked";
  };

  const actionLabel = () => {
    const s = status();
    if (!s) return null;
    if (!s.encrypted) return "Encrypt";
    if (s.locked) return "Unlock";
    return "Lock";
  };

  function handleAction() {
    const s = status();
    if (!s) return;
    setMenuOpen(false);
    setError("");
    if (!s.encrypted) {
      setShowEncryptModal(true);
    } else if (s.locked) {
      setShowUnlockModal(true);
    } else {
      handleLock();
    }
  }

  return (
    <Show when={status()?.vaultExists}>
      <div class="relative" ref={menuRef}>
        <button
          onClick={toggleMenu}
          class="px-2 sm:px-3 py-1 text-sm rounded transition-colors cursor-pointer"
          style={{
            background: "var(--color-bg-surface)",
            color: "var(--color-text-secondary)",
          }}
        >
          Vault
        </button>

        <Show when={menuOpen()}>
          <div
            class="absolute right-0 top-full mt-1 rounded-lg shadow-lg border py-3 px-4 min-w-[180px] z-50"
            style={{
              background: "var(--color-bg-secondary)",
              "border-color": "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            <div class="space-y-2 text-sm" style={{ color: "var(--color-text-secondary)" }}>
              <div class="flex justify-between">
                <span style={{ color: "var(--color-text-muted)" }}>Status</span>
                <span>{statusLabel()}</span>
              </div>
              <div class="flex justify-between">
                <span style={{ color: "var(--color-text-muted)" }}>Entries</span>
                <span>{status()?.entryCount ?? 0}</span>
              </div>
            </div>
            <div class="mt-3 pt-2" style={{ "border-top": "1px solid var(--color-border)" }}>
              <button
                onClick={handleAction}
                class="w-full text-left px-3 py-1.5 text-sm rounded cursor-pointer transition-colors"
                style={{
                  background: "var(--color-bg-surface)",
                  color: "var(--color-text-secondary)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--color-bg-surface)";
                }}
              >
                {actionLabel()}
              </button>
            </div>
          </div>
        </Show>
      </div>

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
