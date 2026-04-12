import { createSignal, createEffect, For, Show } from "solid-js";
import { jobsApi, type JobRecord, type PaginatedJobs } from "../lib/api.ts";

interface Props {
  onClose: () => void;
}

function StatusIcon(props: { status: string }) {
  return (
    <Show when={props.status === "running"} fallback={
      <Show when={props.status === "completed"} fallback={
        <Show when={props.status === "failed"} fallback={
          <span style={{ color: "var(--color-text-muted)" }}>?</span>
        }>
          <span style={{ color: "var(--color-danger)", "font-size": "1.1em" }} title="Failed">&#10007;</span>
        </Show>
      }>
        <span style={{ color: "var(--color-accent)", "font-size": "1.1em" }} title="Completed">&#10003;</span>
      </Show>
    }>
      <span class="inline-block animate-spin" style={{ color: "#f59e0b", "font-size": "1.1em" }} title="Running">&#9696;</span>
    </Show>
  );
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function formatEmbedStats(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null;
  const processed = meta.docsProcessed as number | undefined;
  const totalEmbedded = meta.totalEmbedded as number | undefined;
  if (processed === undefined || totalEmbedded === undefined) return null;
  if (processed === 0 && totalEmbedded === 0) return "no documents";
  if (processed === 0) return `${totalEmbedded} embedded, no changes`;
  return `${processed} / ${totalEmbedded}`;
}

function formatIndexStats(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null;
  const indexed = meta.indexed as number | undefined;
  const updated = meta.updated as number | undefined;
  if (indexed !== undefined && updated !== undefined) {
    const total = indexed + updated;
    if (total === 0) return "no changes";
    const parts: string[] = [];
    if (indexed > 0) parts.push(`${indexed} new`);
    if (updated > 0) parts.push(`${updated} updated`);
    return parts.join(", ");
  }
  return null;
}

export default function JobsList(props: Props) {
  const [data, setData] = createSignal<PaginatedJobs | null>(null);
  const [page, setPage] = createSignal(1);
  const [typeFilter, setTypeFilter] = createSignal<string>("");
  const [expandedError, setExpandedError] = createSignal<number | null>(null);
  const [loading, setLoading] = createSignal(false);

  const pageSize = 15;

  async function load() {
    setLoading(true);
    try {
      const result = await jobsApi.list({
        page: page(),
        pageSize,
        type: typeFilter() || undefined,
      });
      setData(result);
    } catch (err) {
      console.error("Failed to load jobs:", err);
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    // Re-fetch when page or filter changes
    const _p = page();
    const _t = typeFilter();
    load();
  });

  const totalPages = () => {
    const d = data();
    if (!d || d.total === 0) return 1;
    return Math.ceil(d.total / pageSize);
  };

  function formatTime(iso: string | null): string {
    if (!iso) return "-";
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatDuration(ms: number | null): string {
    if (ms === null) return "-";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function jobLabel(type: string): { name: string; trigger: string } {
    const [name, trigger] = type.split(":");
    return { name: name ?? type, trigger: trigger ?? "unknown" };
  }

  return (
    <div
      class="fixed inset-0 flex items-center justify-center z-50 px-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={() => props.onClose()}
    >
      <div
        class="rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col"
        style={{ background: "var(--color-bg-secondary)", color: "var(--color-text-primary)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div class="flex items-center justify-between px-5 py-4 border-b" style={{ "border-color": "var(--color-border)" }}>
          <h2 class="text-lg font-bold">Embed Jobs</h2>
          <div class="flex items-center gap-3">
            <select
              value={typeFilter()}
              onChange={(e) => { setTypeFilter(e.currentTarget.value); setPage(1); }}
              class="px-2 py-1 text-sm rounded border outline-none"
              style={{
                background: "var(--color-bg-surface)",
                "border-color": "var(--color-border)",
                color: "var(--color-text-secondary)",
              }}
            >
              <option value="">All types</option>
              <option value="embed">Embed</option>
              <option value="index">Index</option>
              <option value="embed:background">Embed (background)</option>
              <option value="embed:on-demand">Embed (on-demand)</option>
              <option value="index:background">Index (background)</option>
              <option value="index:on-demand">Index (on-demand)</option>
            </select>
            <button
              onClick={() => load()}
              class="px-2 py-1 text-sm rounded cursor-pointer"
              style={{ background: "var(--color-bg-surface)", color: "var(--color-text-secondary)" }}
              title="Refresh"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Table */}
        <div class="flex-1 overflow-auto">
          <table class="w-full text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <thead>
              <tr
                class="text-left text-xs uppercase"
                style={{ color: "var(--color-text-muted)", background: "var(--color-bg-surface)" }}
              >
                <th class="px-4 py-2 w-8"></th>
                <th class="px-4 py-2">Type</th>
                <th class="px-4 py-2">Trigger</th>
                <th class="px-4 py-2">Started</th>
                <th class="px-4 py-2">Duration</th>
                <th class="px-4 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              <Show when={!loading() && data()?.jobs.length === 0}>
                <tr>
                  <td colspan={6} class="px-4 py-8 text-center" style={{ color: "var(--color-text-muted)" }}>
                    No jobs found
                  </td>
                </tr>
              </Show>
              <Show when={loading()}>
                <tr>
                  <td colspan={6} class="px-4 py-8 text-center" style={{ color: "var(--color-text-muted)" }}>
                    Loading...
                  </td>
                </tr>
              </Show>
              <Show when={!loading()}>
                <For each={data()?.jobs ?? []}>
                  {(job) => {
                    const label = jobLabel(job.type);
                    const isExpanded = () => expandedError() === job.id;
                    const meta = () => parseMetadata(job.metadata);
                    const isEmbed = () => label.name === "embed";
                    const isIndex = () => label.name === "index";
                    return (
                      <>
                        <tr
                          class="border-t"
                          style={{ "border-color": "var(--color-border)" }}
                        >
                          <td class="px-4 py-2 text-center">
                            <StatusIcon status={job.status} />
                          </td>
                          <td class="px-4 py-2 font-medium">{label.name}</td>
                          <td class="px-4 py-2">
                            <span
                              class="text-xs px-1.5 py-0.5 rounded"
                              style={{
                                background: label.trigger === "background" ? "var(--color-bg-surface)" : "var(--color-bg-hover)",
                                color: "var(--color-text-muted)",
                              }}
                            >
                              {label.trigger}
                            </span>
                          </td>
                          <td class="px-4 py-2">{formatTime(job.started_at)}</td>
                          <td class="px-4 py-2">{formatDuration(job.duration_ms)}</td>
                          <td class="px-4 py-2">
                            <Show when={job.status === "failed" && job.error}>
                              <button
                                onClick={() => setExpandedError(isExpanded() ? null : job.id)}
                                class="text-xs px-1.5 py-0.5 rounded cursor-pointer"
                                style={{
                                  background: "var(--color-danger)",
                                  color: "#fff",
                                  opacity: 0.9,
                                }}
                              >
                                {isExpanded() ? "hide error" : "show error"}
                              </button>
                            </Show>
                            <Show when={job.status === "completed" && isEmbed()}>
                              {(() => {
                                const stats = formatEmbedStats(meta());
                                return stats ? (
                                  <span class="text-xs" style={{ color: "var(--color-text-muted)" }} title="docs recomputed / total with embeddings">
                                    {stats}
                                  </span>
                                ) : null;
                              })()}
                            </Show>
                            <Show when={job.status === "completed" && isIndex()}>
                              {(() => {
                                const stats = formatIndexStats(meta());
                                return stats ? (
                                  <span class="text-xs" style={{ color: "var(--color-text-muted)" }}>
                                    {stats}
                                  </span>
                                ) : null;
                              })()}
                            </Show>
                            <Show when={job.status === "running"}>
                              <span class="text-xs" style={{ color: "var(--color-text-muted)" }}>in progress</span>
                            </Show>
                          </td>
                        </tr>
                        <Show when={isExpanded() && job.error}>
                          <tr style={{ background: "var(--color-bg-surface)" }}>
                            <td colspan={6} class="px-4 py-3">
                              <pre
                                class="text-xs whitespace-pre-wrap break-all rounded p-2"
                                style={{
                                  background: "var(--color-bg-primary)",
                                  color: "var(--color-danger)",
                                }}
                              >
                                {job.error}
                              </pre>
                            </td>
                          </tr>
                        </Show>
                      </>
                    );
                  }}
                </For>
              </Show>
            </tbody>
          </table>
        </div>

        {/* Footer / pagination */}
        <div
          class="flex items-center justify-between px-5 py-3 border-t text-sm"
          style={{ "border-color": "var(--color-border)", color: "var(--color-text-muted)" }}
        >
          <span>
            {data() ? `${data()!.total} job${data()!.total !== 1 ? "s" : ""}` : ""}
          </span>
          <div class="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page() <= 1}
              class="px-2 py-1 rounded cursor-pointer disabled:opacity-30 disabled:cursor-default"
              style={{ background: "var(--color-bg-surface)", color: "var(--color-text-secondary)" }}
            >
              Prev
            </button>
            <span>
              {page()} / {totalPages()}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages(), p + 1))}
              disabled={page() >= totalPages()}
              class="px-2 py-1 rounded cursor-pointer disabled:opacity-30 disabled:cursor-default"
              style={{ background: "var(--color-bg-surface)", color: "var(--color-text-secondary)" }}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
