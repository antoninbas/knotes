import { createSignal, createEffect, For, Show } from "solid-js";
import {
  githubApi,
  type GhAccount,
  type GhConnection,
  type GhBodyMode,
  type GhMonitor,
  type GhSyncResult,
  type AddGithubConnectionInput,
  type UpdateGithubConnectionInput,
} from "../lib/api.ts";

interface Props {
  logPath: string;
  readOnly?: boolean;
}

const MONITOR_OPTIONS: { value: GhMonitor; label: string; help: string }[] = [
  { value: "opened_prs", label: "Opened PRs", help: "Track every PR you open through its full lifecycle (open / closed / merged)" },
  { value: "merged_prs", label: "Merged PRs only", help: "Surface only PRs that landed (skip open / closed-without-merge)" },
  { value: "opened_issues", label: "Issues", help: "Issues you authored; OPEN entries update to CLOSED in place" },
  { value: "pr_reviews", label: "PR reviews", help: "Each review you submit produces its own entry" },
];

const BODY_MODE_OPTIONS: { value: GhBodyMode; label: string }[] = [
  { value: "title", label: "Title only" },
  { value: "first_paragraph", label: "First paragraph" },
  { value: "first_chars", label: "First N characters" },
  { value: "full", label: "Full body" },
];

interface FormState {
  accountKey: string;       // host:login, "" if no selection
  monitors: Set<GhMonitor>;
  includeOrgs: string[];
  excludeOrgs: string[];
  includeRepos: string[];
  excludeRepos: string[];
  since: string;            // ISO 'YYYY-MM-DD' or ""
  bodyMode: GhBodyMode;
  bodyMaxChars: number;
  enabled: boolean;
}

function emptyForm(): FormState {
  return {
    accountKey: "",
    monitors: new Set(["opened_prs", "merged_prs", "opened_issues", "pr_reviews"]),
    includeOrgs: [],
    excludeOrgs: [],
    includeRepos: [],
    excludeRepos: [],
    since: "",
    bodyMode: "title",
    bodyMaxChars: 500,
    enabled: true,
  };
}

function parseList(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function fmtList(arr: string[] | null | undefined): string {
  return (arr ?? []).join(", ");
}

function fmtTimestamp(ts: string | null | undefined): string {
  if (!ts) return "never";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function lastSyncSummary(jobMeta: string | null): string {
  if (!jobMeta) return "";
  try {
    const m = JSON.parse(jobMeta);
    const parts = [
      `pulled=${m.pulled ?? 0}`,
      `written=${m.written ?? 0}`,
      `updated=${m.updated ?? 0}`,
      `skipped=${m.skipped ?? 0}`,
    ];
    if (m.rateLimited) parts.push("RATE LIMITED");
    return parts.join(" ");
  } catch {
    return "";
  }
}

export default function GithubConnectionsPanel(props: Props) {
  const [accounts, setAccounts] = createSignal<GhAccount[]>([]);
  const [connections, setConnections] = createSignal<GhConnection[]>([]);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [busyId, setBusyId] = createSignal<number | null>(null);
  const [syncResults, setSyncResults] = createSignal<GhSyncResult[]>([]);
  const [globalError, setGlobalError] = createSignal<string | null>(null);

  // Form state — null means "not editing"; "new" means adding fresh.
  type EditingMode = null | { kind: "new" } | { kind: "edit"; id: number };
  const [editing, setEditing] = createSignal<EditingMode>(null);
  const [form, setForm] = createSignal<FormState>(emptyForm());
  const [formError, setFormError] = createSignal<string | null>(null);
  const [formSaving, setFormSaving] = createSignal(false);

  async function reload() {
    setLoadError(null);
    try {
      const [a, c] = await Promise.all([
        githubApi.listAccounts(),
        githubApi.listConnections(props.logPath),
      ]);
      setAccounts(a);
      setConnections(c);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load GitHub data");
    }
  }

  createEffect(() => {
    const _ = props.logPath;
    reload();
  });

  function startNew() {
    const f = emptyForm();
    if (accounts().length > 0) {
      const first = accounts()[0]!;
      f.accountKey = `${first.host}:${first.login}`;
    }
    setForm(f);
    setFormError(null);
    setEditing({ kind: "new" });
  }

  function startEdit(conn: GhConnection) {
    const acct = accounts().find((a) => a.id === conn.accountId);
    setForm({
      accountKey: acct ? `${acct.host}:${acct.login}` : "",
      monitors: new Set(conn.monitors),
      includeOrgs: conn.includeOrgs ?? [],
      excludeOrgs: conn.excludeOrgs ?? [],
      includeRepos: conn.includeRepos ?? [],
      excludeRepos: conn.excludeRepos ?? [],
      since: conn.since ? conn.since.slice(0, 10) : "",
      bodyMode: conn.bodyMode,
      bodyMaxChars: conn.bodyMaxChars ?? 500,
      enabled: conn.enabled,
    });
    setFormError(null);
    setEditing({ kind: "edit", id: conn.id });
  }

  function cancelEdit() {
    setEditing(null);
    setFormError(null);
  }

  function toggleMonitor(m: GhMonitor) {
    const f = form();
    const next = new Set(f.monitors);
    if (next.has(m)) next.delete(m);
    else next.add(m);
    setForm({ ...f, monitors: next });
  }

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm({ ...form(), [k]: v });
  }

  async function saveForm() {
    const mode = editing();
    if (!mode) return;
    const f = form();
    const monitors = Array.from(f.monitors) as GhMonitor[];
    if (monitors.length === 0) {
      setFormError("Select at least one monitor");
      return;
    }
    if (mode.kind === "new" && !f.accountKey) {
      setFormError("Pick an account");
      return;
    }
    if (f.bodyMode === "first_chars" && (!f.bodyMaxChars || f.bodyMaxChars <= 0)) {
      setFormError("First N characters: N must be > 0");
      return;
    }

    setFormSaving(true);
    setFormError(null);
    try {
      if (mode.kind === "new") {
        const [host, ...loginParts] = f.accountKey.split(":");
        const login = loginParts.join(":");
        const input: AddGithubConnectionInput = {
          logPath: props.logPath,
          host: host!,
          login,
          monitors,
          includeOrgs: f.includeOrgs.length > 0 ? f.includeOrgs : undefined,
          excludeOrgs: f.excludeOrgs.length > 0 ? f.excludeOrgs : undefined,
          includeRepos: f.includeRepos.length > 0 ? f.includeRepos : undefined,
          excludeRepos: f.excludeRepos.length > 0 ? f.excludeRepos : undefined,
          since: f.since ? new Date(f.since).toISOString() : undefined,
          bodyMode: f.bodyMode,
          bodyMaxChars: f.bodyMode === "first_chars" ? f.bodyMaxChars : null,
        };
        await githubApi.addConnection(input);
      } else {
        const patch: UpdateGithubConnectionInput = {
          monitors,
          includeOrgs: f.includeOrgs.length > 0 ? f.includeOrgs : null,
          excludeOrgs: f.excludeOrgs.length > 0 ? f.excludeOrgs : null,
          includeRepos: f.includeRepos.length > 0 ? f.includeRepos : null,
          excludeRepos: f.excludeRepos.length > 0 ? f.excludeRepos : null,
          since: f.since ? new Date(f.since).toISOString() : undefined,
          enabled: f.enabled,
          bodyMode: f.bodyMode,
          bodyMaxChars: f.bodyMode === "first_chars" ? f.bodyMaxChars : null,
        };
        await githubApi.updateConnection(mode.id, patch);
      }
      setEditing(null);
      await reload();
    } catch (err: any) {
      setFormError(err.message || "Failed to save connection");
    } finally {
      setFormSaving(false);
    }
  }

  async function deleteConnection(id: number) {
    if (!window.confirm("Delete this GitHub connection? Existing log entries are kept.")) return;
    setBusyId(id);
    setGlobalError(null);
    try {
      await githubApi.removeConnection(id);
      await reload();
    } catch (err: any) {
      setGlobalError(err.message || "Failed to delete connection");
    } finally {
      setBusyId(null);
    }
  }

  async function syncOne(id: number) {
    setBusyId(id);
    setGlobalError(null);
    setSyncResults([]);
    try {
      const results = await githubApi.sync({ connectionId: id });
      setSyncResults(results);
      await reload();
    } catch (err: any) {
      setGlobalError(err.message || "Sync failed");
    } finally {
      setBusyId(null);
    }
  }

  async function syncAllForJournal() {
    setBusyId(-1);
    setGlobalError(null);
    setSyncResults([]);
    try {
      const results = await githubApi.sync({ logPath: props.logPath });
      setSyncResults(results);
      await reload();
    } catch (err: any) {
      setGlobalError(err.message || "Sync failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      class="rounded border p-4 space-y-3"
      style={{
        "background-color": "var(--color-bg-surface)",
        "border-color": "var(--color-border)",
      }}
    >
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          GitHub connections
        </h3>
        <div class="flex gap-2">
          <Show when={!props.readOnly && connections().length > 0}>
            <button
              onClick={syncAllForJournal}
              disabled={busyId() !== null}
              class="px-2 py-1 text-xs rounded cursor-pointer disabled:opacity-50"
              style={{ background: "var(--color-bg-hover)", color: "var(--color-text-secondary)" }}
              title="Sync all connections for this journal"
            >
              {busyId() === -1 ? "Syncing…" : "Sync all"}
            </button>
          </Show>
          <Show when={!props.readOnly && editing() === null}>
            <button
              onClick={startNew}
              class="px-2 py-1 text-xs rounded cursor-pointer"
              style={{ background: "var(--color-accent)", color: "#fff" }}
            >
              + Add connection
            </button>
          </Show>
        </div>
      </div>

      <Show when={loadError()}>
        <p class="text-xs" style={{ color: "#dc2626" }}>{loadError()}</p>
      </Show>
      <Show when={globalError()}>
        <p class="text-xs" style={{ color: "#dc2626" }}>{globalError()}</p>
      </Show>

      <Show when={accounts().length === 0 && editing() === null}>
        <p class="text-xs italic" style={{ color: "var(--color-text-muted)" }}>
          No GitHub accounts configured. Run{" "}
          <code class="px-1 rounded" style={{ background: "var(--color-bg-hover)" }}>
            knotes github auth login
          </code>{" "}
          to add one.
        </p>
      </Show>

      <Show when={connections().length === 0 && editing() === null && accounts().length > 0 && !loadError()}>
        <p class="text-xs italic" style={{ color: "var(--color-text-muted)" }}>
          No GitHub connections for this journal yet.
        </p>
      </Show>

      <For each={connections()}>
        {(c) => {
          const acct = accounts().find((a) => a.id === c.accountId);
          return (
            <div
              class="rounded border p-3 text-xs space-y-1"
              style={{
                "border-color": "var(--color-border)",
                "background-color": "var(--color-bg)",
                opacity: c.enabled ? 1 : 0.55,
              }}
            >
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div style={{ color: "var(--color-text-primary)" }}>
                  <span class="font-medium">#{c.id}</span>
                  {" "}·{" "}
                  <span>{acct ? `${acct.host}:${acct.login}` : `account#${c.accountId}`}</span>
                  <Show when={!c.enabled}>
                    <span class="ml-2 px-1 rounded text-[10px]" style={{ background: "var(--color-bg-hover)", color: "var(--color-text-muted)" }}>
                      disabled
                    </span>
                  </Show>
                </div>
                <Show when={!props.readOnly}>
                  <div class="flex gap-1">
                    <button
                      onClick={() => syncOne(c.id)}
                      disabled={busyId() !== null}
                      class="px-2 py-0.5 rounded cursor-pointer disabled:opacity-50"
                      style={{ background: "var(--color-bg-hover)", color: "var(--color-text-secondary)" }}
                    >
                      {busyId() === c.id ? "Syncing…" : "Sync"}
                    </button>
                    <button
                      onClick={() => startEdit(c)}
                      disabled={busyId() !== null}
                      class="px-2 py-0.5 rounded cursor-pointer disabled:opacity-50"
                      style={{ background: "var(--color-bg-hover)", color: "var(--color-text-secondary)" }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteConnection(c.id)}
                      disabled={busyId() !== null}
                      class="px-2 py-0.5 rounded cursor-pointer disabled:opacity-50"
                      style={{ background: "var(--color-bg-hover)", color: "#dc2626" }}
                    >
                      Delete
                    </button>
                  </div>
                </Show>
              </div>
              <div style={{ color: "var(--color-text-secondary)" }}>
                Monitors: {c.monitors.join(", ")}
              </div>
              <div style={{ color: "var(--color-text-secondary)" }}>
                Body: {c.bodyMode}{c.bodyMaxChars ? `:${c.bodyMaxChars}` : ""}
                {" · "}Since: {c.since.slice(0, 10)}
                {" · "}Last synced: {fmtTimestamp(c.lastSyncedAt)}
              </div>
              <Show when={c.includeOrgs || c.excludeOrgs || c.includeRepos || c.excludeRepos}>
                <div style={{ color: "var(--color-text-muted)" }}>
                  <Show when={c.includeOrgs}><span>include-org=[{fmtList(c.includeOrgs)}] </span></Show>
                  <Show when={c.excludeOrgs}><span>exclude-org=[{fmtList(c.excludeOrgs)}] </span></Show>
                  <Show when={c.includeRepos}><span>include-repo=[{fmtList(c.includeRepos)}] </span></Show>
                  <Show when={c.excludeRepos}><span>exclude-repo=[{fmtList(c.excludeRepos)}]</span></Show>
                </div>
              </Show>
            </div>
          );
        }}
      </For>

      <Show when={syncResults().length > 0}>
        <div class="rounded border p-2 text-xs" style={{ "border-color": "var(--color-border)" }}>
          <div class="font-medium mb-1" style={{ color: "var(--color-text-primary)" }}>
            Last sync:
          </div>
          <For each={syncResults()}>
            {(r) => (
              <div style={{ color: "var(--color-text-secondary)" }}>
                connection {r.connectionId}: pulled={r.pulled} written={r.written} updated={r.updated} skipped={r.skipped}
                {r.rateLimited ? ` (RATE LIMITED${r.nextRetryAt ? `, retry after ${r.nextRetryAt}` : ""})` : ""}
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={editing() !== null}>
        <div
          class="rounded border p-3 space-y-3 text-xs"
          style={{
            "border-color": "var(--color-accent)",
            "background-color": "var(--color-bg)",
          }}
        >
          <div class="font-medium" style={{ color: "var(--color-text-primary)" }}>
            {editing()?.kind === "new" ? "New connection" : `Edit connection`}
          </div>

          <Show when={editing()?.kind === "new"}>
            <div>
              <label class="block mb-1" style={{ color: "var(--color-text-muted)" }}>Account</label>
              <select
                value={form().accountKey}
                onChange={(e) => setField("accountKey", e.currentTarget.value)}
                class="w-full px-2 py-1 rounded border outline-none"
                style={{
                  "background-color": "var(--color-bg-surface)",
                  "border-color": "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              >
                <For each={accounts()}>
                  {(a) => (
                    <option value={`${a.host}:${a.login}`}>
                      {a.host}:{a.login} ({a.authMethod})
                    </option>
                  )}
                </For>
              </select>
            </div>
          </Show>

          <div>
            <label class="block mb-1" style={{ color: "var(--color-text-muted)" }}>Monitors</label>
            <div class="space-y-1">
              <For each={MONITOR_OPTIONS}>
                {(opt) => (
                  <label class="flex items-start gap-2 cursor-pointer" title={opt.help}>
                    <input
                      type="checkbox"
                      checked={form().monitors.has(opt.value)}
                      onChange={() => toggleMonitor(opt.value)}
                    />
                    <span style={{ color: "var(--color-text-primary)" }}>{opt.label}</span>
                  </label>
                )}
              </For>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block mb-1" style={{ color: "var(--color-text-muted)" }}>Include orgs</label>
              <input
                type="text"
                placeholder="acme, antrea-io"
                value={form().includeOrgs.join(", ")}
                onInput={(e) => setField("includeOrgs", parseList(e.currentTarget.value))}
                class="w-full px-2 py-1 rounded border outline-none"
                style={{ "background-color": "var(--color-bg-surface)", "border-color": "var(--color-border)", color: "var(--color-text-primary)" }}
              />
            </div>
            <div>
              <label class="block mb-1" style={{ color: "var(--color-text-muted)" }}>Exclude orgs</label>
              <input
                type="text"
                placeholder="bots, dependabot"
                value={form().excludeOrgs.join(", ")}
                onInput={(e) => setField("excludeOrgs", parseList(e.currentTarget.value))}
                class="w-full px-2 py-1 rounded border outline-none"
                style={{ "background-color": "var(--color-bg-surface)", "border-color": "var(--color-border)", color: "var(--color-text-primary)" }}
              />
            </div>
            <div>
              <label class="block mb-1" style={{ color: "var(--color-text-muted)" }}>Include repos</label>
              <input
                type="text"
                placeholder="acme/thing, acme/other"
                value={form().includeRepos.join(", ")}
                onInput={(e) => setField("includeRepos", parseList(e.currentTarget.value))}
                class="w-full px-2 py-1 rounded border outline-none"
                style={{ "background-color": "var(--color-bg-surface)", "border-color": "var(--color-border)", color: "var(--color-text-primary)" }}
              />
            </div>
            <div>
              <label class="block mb-1" style={{ color: "var(--color-text-muted)" }}>Exclude repos</label>
              <input
                type="text"
                placeholder="acme/secret"
                value={form().excludeRepos.join(", ")}
                onInput={(e) => setField("excludeRepos", parseList(e.currentTarget.value))}
                class="w-full px-2 py-1 rounded border outline-none"
                style={{ "background-color": "var(--color-bg-surface)", "border-color": "var(--color-border)", color: "var(--color-text-primary)" }}
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block mb-1" style={{ color: "var(--color-text-muted)" }}>Since (default: 7d ago)</label>
              <input
                type="date"
                value={form().since}
                onInput={(e) => setField("since", e.currentTarget.value)}
                class="w-full px-2 py-1 rounded border outline-none"
                style={{ "background-color": "var(--color-bg-surface)", "border-color": "var(--color-border)", color: "var(--color-text-primary)" }}
              />
            </div>
            <div>
              <label class="block mb-1" style={{ color: "var(--color-text-muted)" }}>Body inclusion</label>
              <select
                value={form().bodyMode}
                onChange={(e) => setField("bodyMode", e.currentTarget.value as GhBodyMode)}
                class="w-full px-2 py-1 rounded border outline-none"
                style={{ "background-color": "var(--color-bg-surface)", "border-color": "var(--color-border)", color: "var(--color-text-primary)" }}
              >
                <For each={BODY_MODE_OPTIONS}>
                  {(opt) => <option value={opt.value}>{opt.label}</option>}
                </For>
              </select>
            </div>
          </div>

          <Show when={form().bodyMode === "first_chars"}>
            <div>
              <label class="block mb-1" style={{ color: "var(--color-text-muted)" }}>Max characters</label>
              <input
                type="number"
                min="1"
                value={form().bodyMaxChars}
                onInput={(e) => setField("bodyMaxChars", parseInt(e.currentTarget.value, 10) || 0)}
                class="w-full px-2 py-1 rounded border outline-none"
                style={{ "background-color": "var(--color-bg-surface)", "border-color": "var(--color-border)", color: "var(--color-text-primary)" }}
              />
            </div>
          </Show>

          <Show when={editing()?.kind === "edit"}>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form().enabled}
                onChange={(e) => setField("enabled", e.currentTarget.checked)}
              />
              <span style={{ color: "var(--color-text-primary)" }}>Enabled</span>
            </label>
          </Show>

          <Show when={formError()}>
            <p style={{ color: "#dc2626" }}>{formError()}</p>
          </Show>

          <div class="flex gap-2">
            <button
              onClick={saveForm}
              disabled={formSaving()}
              class="px-3 py-1 rounded cursor-pointer disabled:opacity-50"
              style={{ background: "var(--color-accent)", color: "#fff" }}
            >
              {formSaving() ? "Saving…" : "Save"}
            </button>
            <button
              onClick={cancelEdit}
              disabled={formSaving()}
              class="px-3 py-1 rounded cursor-pointer disabled:opacity-50"
              style={{ background: "var(--color-bg-hover)", color: "var(--color-text-secondary)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
