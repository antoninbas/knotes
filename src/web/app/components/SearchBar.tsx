import { createSignal, For, Show } from "solid-js";
import { searchApi, notes as notesApi, type SearchResult, type NoteResult } from "../lib/api.ts";

interface Props {
  onClose: () => void;
  onSelect: (note: NoteResult) => void;
}

export default function SearchBar(props: Props) {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<SearchResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  let debounceTimer: ReturnType<typeof setTimeout>;

  function handleInput(value: string) {
    setQuery(value);
    clearTimeout(debounceTimer);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    debounceTimer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchApi.search(value, { limit: 10 });
        setResults(res);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  async function handleSelect(result: SearchResult) {
    try {
      const note = await notesApi.get(result.path);
      props.onSelect(note);
    } catch (err) {
      console.error("Failed to load note:", err);
    }
  }

  return (
    <div
      class="fixed inset-0 flex items-start justify-center pt-12 sm:pt-24 px-4 z-50"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        class="w-full max-w-xl rounded-lg shadow-2xl overflow-hidden"
        style={{ "background-color": "var(--color-bg-secondary)" }}
      >
        <input
          type="text"
          value={query()}
          onInput={(e) => handleInput(e.currentTarget.value)}
          placeholder="Search notes and logs..."
          autofocus
          class="w-full px-4 py-3 text-lg border-b outline-none"
          style={{
            "background-color": "var(--color-bg-secondary)",
            "border-color": "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") props.onClose();
          }}
        />

        <div class="max-h-96 overflow-y-auto">
          <Show when={loading()}>
            <div class="px-4 py-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
              Searching...
            </div>
          </Show>

          <Show when={!loading() && query().trim() && results().length === 0}>
            <div class="px-4 py-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
              No results found
            </div>
          </Show>

          <For each={results()}>
            {(result) => (
              <div
                class="px-4 py-3 cursor-pointer transition-colors border-b"
                style={{ "border-color": "var(--color-border)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = "var(--color-bg-hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "transparent")
                }
                onClick={() => handleSelect(result)}
              >
                <div class="flex items-center justify-between">
                  <span class="font-medium text-sm" style={{ color: "var(--color-text-primary)" }}>
                    {result.title || result.path}
                  </span>
                  <span class="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {result.score.toFixed(2)}
                  </span>
                </div>
                <div class="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
                  {result.path}
                </div>
                <Show when={result.snippet}>
                  <div
                    class="text-xs mt-1 line-clamp-2"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {result.snippet.slice(0, 150)}
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
