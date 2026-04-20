import { createSignal, createEffect, For, Show } from "solid-js";
import { notes, type ListEntry } from "../lib/api.ts";

interface Props {
  entry: ListEntry;
  onClose: () => void;
  onMoved: (oldPath: string, newPath: string) => void;
}

/**
 * Modal folder picker. Lets the user move a note, journal, or folder
 * to any folder under the same top-level zone (notes/ or logs/).
 *
 * Disallowed targets:
 *   - the entry's current parent (would be a no-op)
 *   - the entry itself (folders can't contain themselves)
 *   - any descendant of the entry (would orphan the move)
 */
export default function MoveDialog(props: Props) {
  const sourcePath = props.entry.path;
  const sourceSegments = sourcePath.split("/");
  const sourceName = sourceSegments[sourceSegments.length - 1]!;
  const sourceParent = sourceSegments.slice(0, -1).join("/");
  const zone = sourceSegments[0]!; // "notes" or "logs"
  const isDirectory = props.entry.type === "directory";
  const label =
    props.entry.type === "directory"
      ? "folder"
      : props.entry.type === "log"
        ? "journal"
        : "note";

  // Browse state — initial location is the zone root so the user sees the top.
  const [browsePath, setBrowsePath] = createSignal<string>(zone);
  const [children, setChildren] = createSignal<ListEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);

  async function loadChildren(path: string) {
    setLoading(true);
    try {
      const items = await notes.list(path);
      setChildren(items.filter((e) => e.type === "directory"));
    } catch (err: any) {
      setError(err.message || "Failed to load folder");
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    loadChildren(browsePath());
  });

  function isDescendantOfSource(path: string): boolean {
    if (!isDirectory) return false;
    return path === sourcePath || path.startsWith(`${sourcePath}/`);
  }

  function canSelect(path: string): boolean {
    if (isDescendantOfSource(path)) return false;
    if (path === sourceParent) return false;
    return true;
  }

  function navigateInto(path: string) {
    setBrowsePath(path);
  }

  function navigateUp() {
    const segs = browsePath().split("/");
    if (segs.length <= 1) return; // already at zone root
    setBrowsePath(segs.slice(0, -1).join("/"));
  }

  async function handleMove() {
    const target = browsePath();
    if (!canSelect(target)) return;
    setError(null);
    setSubmitting(true);
    const newPath = `${target}/${sourceName}`;
    try {
      if (isDirectory) {
        await notes.renameFolder(sourcePath, newPath);
      } else {
        await notes.rename(sourcePath, newPath);
      }
      props.onMoved(sourcePath, newPath);
      props.onClose();
    } catch (err: any) {
      setError(err.message || "Move failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center"
      style={{ "background-color": "rgba(0,0,0,0.5)" }}
      onClick={props.onClose}
    >
      <div
        class="rounded shadow-lg border w-[420px] max-h-[70vh] flex flex-col"
        style={{
          "background-color": "var(--color-bg-surface)",
          "border-color": "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          class="px-4 py-3 border-b"
          style={{ "border-color": "var(--color-border)" }}
        >
          <p class="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Move {label} <span style={{ color: "var(--color-accent)" }}>{sourceName}</span>
          </p>
          <p class="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            Pick a destination folder inside {zone}/.
          </p>
        </div>

        {/* Breadcrumb / back */}
        <div
          class="flex items-center gap-2 px-4 py-2 text-xs border-b"
          style={{ "border-color": "var(--color-border)", color: "var(--color-text-muted)" }}
        >
          <Show when={browsePath() !== zone}>
            <button
              class="cursor-pointer"
              style={{ color: "var(--color-accent)" }}
              onClick={navigateUp}
            >
              &#8592; up
            </button>
          </Show>
          <span>{browsePath()}/</span>
        </div>

        {/* Folder list */}
        <div class="flex-1 overflow-y-auto py-1">
          <Show when={loading()}>
            <p class="px-4 py-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
              Loading...
            </p>
          </Show>
          <Show when={!loading() && children().length === 0}>
            <p class="px-4 py-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
              (no subfolders)
            </p>
          </Show>
          <For each={children()}>
            {(entry) => {
              const disabled = isDescendantOfSource(entry.path);
              return (
                <button
                  class="w-full text-left flex items-center gap-2 px-4 py-1.5 text-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ color: "var(--color-text-secondary)" }}
                  onMouseEnter={(e) =>
                    !disabled && (e.currentTarget.style.backgroundColor = "var(--color-bg-hover)")
                  }
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                  disabled={disabled}
                  onClick={() => navigateInto(entry.path)}
                  title={disabled ? "Cannot move a folder into itself" : entry.path}
                >
                  <span class="shrink-0">{"\u{1F4C1}"}</span>
                  <span class="truncate">{entry.title}</span>
                </button>
              );
            }}
          </For>
        </div>

        {/* Footer */}
        <div
          class="px-4 py-3 border-t space-y-2"
          style={{ "border-color": "var(--color-border)" }}
        >
          <Show when={error()}>
            <p class="text-xs text-red-500">{error()}</p>
          </Show>
          <Show when={!canSelect(browsePath()) && !error()}>
            <p class="text-xs" style={{ color: "var(--color-text-muted)" }}>
              <Show when={browsePath() === sourceParent}>
                Already in this folder.
              </Show>
              <Show when={isDescendantOfSource(browsePath())}>
                Cannot move a folder into itself.
              </Show>
            </p>
          </Show>
          <div class="flex gap-2">
            <button
              class="flex-1 px-3 py-1.5 text-sm rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--color-accent)", color: "#fff" }}
              disabled={!canSelect(browsePath()) || submitting()}
              onClick={handleMove}
            >
              {submitting() ? "Moving..." : `Move here`}
            </button>
            <button
              class="flex-1 px-3 py-1.5 text-sm rounded cursor-pointer"
              style={{
                background: "var(--color-bg-hover)",
                color: "var(--color-text-secondary)",
              }}
              onClick={props.onClose}
              disabled={submitting()}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
