import { createSignal, For, Show, onMount } from "solid-js";
import { searchApi, notes as notesApi, type SearchResult, type NoteResult } from "../lib/api.ts";

type SearchMode = "bm25" | "vector" | "hybrid";

interface Props {
  onSelect: (note: NoteResult) => void;
}

type CollectionFilter = "all" | "notes" | "logs";

export default function SearchView(props: Props) {
  const [query, setQuery] = createSignal("");
  const [mode, setMode] = createSignal<SearchMode>("hybrid");
  const [withRerank, setWithRerank] = createSignal(false);
  const [withExpand, setWithExpand] = createSignal(false);
  const [minScoreInput, setMinScoreInput] = createSignal("");
  const [collection, setCollection] = createSignal<CollectionFilter>("all");
  const [results, setResults] = createSignal<SearchResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [searched, setSearched] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let inputRef!: HTMLInputElement;

  onMount(() => inputRef?.focus());

  const minScoreHint = () => {
    switch (mode()) {
      case "bm25":
        return "BM25 sigmoid score in [0, 1). ~0.3 weak, ~0.6 medium, ~0.9 strong.";
      case "vector":
        return "Cosine similarity in [0, 1]. ~0.3 noise floor, ~0.5 semantically related.";
      case "hybrid":
        return "Fused RRF score. Much smaller: ~0.02–0.08 for good matches.";
    }
  };

  async function doSearch() {
    const q = query().trim();
    if (!q) return;

    let minScore: number | undefined;
    const raw = minScoreInput().trim();
    if (raw !== "") {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError("Min score must be a non-negative number.");
        return;
      }
      minScore = parsed;
    }

    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const opts: Parameters<typeof searchApi.search>[1] = { limit: 20, mode: mode() };
      if (mode() === "hybrid") {
        opts.rerank = withRerank();
        opts.queryExpand = withExpand();
      }
      if (minScore !== undefined) opts.minScore = minScore;
      if (collection() !== "all") opts.collections = [collection() as "notes" | "logs"];
      const res = await searchApi.search(q, opts);
      setResults(res);
    } catch (err: any) {
      setError(err.message ?? "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSelect(result: SearchResult) {
    try {
      const note = await notesApi.get(result.path);
      props.onSelect(note);
    } catch (err) {
      console.error("Failed to load note:", err);
    }
  }

  const modeActive = (m: SearchMode) => ({
    background: mode() === m ? "var(--color-accent)" : "var(--color-bg-surface)",
    color: mode() === m ? "#fff" : "var(--color-text-secondary)",
  });

  const collectionActive = (c: CollectionFilter) => ({
    background: collection() === c ? "var(--color-accent)" : "var(--color-bg-surface)",
    color: collection() === c ? "#fff" : "var(--color-text-secondary)",
  });

  return (
    <div class="flex flex-col h-full">
      {/* Search header */}
      <div
        class="px-4 sm:px-6 pt-5 pb-4 border-b shrink-0"
        style={{ "border-color": "var(--color-border)", "background-color": "var(--color-bg-secondary)" }}
      >
        <h2 class="text-lg font-semibold mb-4" style={{ color: "var(--color-text-primary)" }}>
          Search
        </h2>

        {/* Input + button */}
        <div class="flex gap-2">
          <input
            ref={inputRef!}
            type="text"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }}
            placeholder="Search notes and logs..."
            class="flex-1 px-4 py-2 rounded-lg border text-sm outline-none"
            style={{
              "background-color": "var(--color-bg-primary)",
              "border-color": "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
          <button
            onClick={doSearch}
            disabled={loading()}
            class="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors shrink-0"
            style={{
              background: "var(--color-accent)",
              color: "#fff",
              opacity: loading() ? "0.6" : "1",
              cursor: loading() ? "default" : "pointer",
            }}
          >
            {loading() ? "Searching…" : "Search"}
          </button>
        </div>

        {/* Mode selector */}
        <div class="flex items-center gap-3 mt-3 flex-wrap">
          {/* Segmented mode buttons */}
          <div
            class="flex rounded-lg overflow-hidden border text-sm shrink-0"
            style={{ "border-color": "var(--color-border)" }}
          >
            <button
              onClick={() => setMode("bm25")}
              class="px-3 py-1.5 cursor-pointer transition-colors"
              style={{
                ...modeActive("bm25"),
                "border-right": "1px solid var(--color-border)",
              }}
              title="Keyword search (fast, exact matches)"
            >
              BM25
            </button>
            <button
              onClick={() => setMode("vector")}
              class="px-3 py-1.5 cursor-pointer transition-colors"
              style={{
                ...modeActive("vector"),
                "border-right": "1px solid var(--color-border)",
              }}
              title="Semantic search (finds conceptually similar content)"
            >
              Vector
            </button>
            <button
              onClick={() => setMode("hybrid")}
              class="px-3 py-1.5 cursor-pointer transition-colors"
              style={modeActive("hybrid")}
              title="Combined BM25 + vector (default)"
            >
              Hybrid
            </button>
          </div>

          {/* Collection filter */}
          <div
            class="flex rounded-lg overflow-hidden border text-sm shrink-0"
            style={{ "border-color": "var(--color-border)" }}
            title="Restrict results to notes, logs, or both"
          >
            <button
              onClick={() => setCollection("all")}
              class="px-3 py-1.5 cursor-pointer transition-colors"
              style={{ ...collectionActive("all"), "border-right": "1px solid var(--color-border)" }}
            >
              All
            </button>
            <button
              onClick={() => setCollection("notes")}
              class="px-3 py-1.5 cursor-pointer transition-colors"
              style={{ ...collectionActive("notes"), "border-right": "1px solid var(--color-border)" }}
            >
              Notes
            </button>
            <button
              onClick={() => setCollection("logs")}
              class="px-3 py-1.5 cursor-pointer transition-colors"
              style={collectionActive("logs")}
            >
              Logs
            </button>
          </div>

          {/* LLM options — only relevant for Hybrid */}
          <Show when={mode() === "hybrid"}>
            <label
              class="flex items-center gap-1.5 text-sm cursor-pointer select-none"
              style={{ color: "var(--color-text-secondary)" }}
            >
              <input
                type="checkbox"
                checked={withExpand()}
                onChange={(e) => setWithExpand(e.currentTarget.checked)}
                class="cursor-pointer"
              />
              Query Expansion
              <span class="text-xs" style={{ color: "var(--color-text-muted)" }}>(slow)</span>
            </label>
            <label
              class="flex items-center gap-1.5 text-sm cursor-pointer select-none"
              style={{ color: "var(--color-text-secondary)" }}
            >
              <input
                type="checkbox"
                checked={withRerank()}
                onChange={(e) => setWithRerank(e.currentTarget.checked)}
                class="cursor-pointer"
              />
              Reranking
              <span class="text-xs" style={{ color: "var(--color-text-muted)" }}>(slow)</span>
            </label>
          </Show>

          {/* Min score filter */}
          <label
            class="flex items-center gap-1.5 text-sm select-none"
            style={{ color: "var(--color-text-secondary)" }}
            title={`Drop results below this score. Default empty = off. ${minScoreHint()}`}
          >
            Min score
            <input
              type="number"
              step="0.01"
              min="0"
              value={minScoreInput()}
              onInput={(e) => setMinScoreInput(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }}
              placeholder="off"
              class="w-20 px-2 py-1 rounded border text-sm outline-none"
              style={{
                "background-color": "var(--color-bg-primary)",
                "border-color": "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </label>
        </div>

        {/* Mode-specific min-score hint */}
        <div
          class="text-xs mt-2"
          style={{ color: "var(--color-text-muted)" }}
        >
          {minScoreHint()} Leave empty to return all results.
        </div>
      </div>

      {/* Results */}
      <div
        class="flex-1 overflow-auto p-4 sm:p-6"
        style={{ "background-color": "var(--color-bg-primary)" }}
      >
        <Show when={loading()}>
          <div class="text-sm" style={{ color: "var(--color-text-muted)" }}>Searching…</div>
        </Show>

        <Show when={error()}>
          <div class="text-sm" style={{ color: "var(--color-danger)" }}>{error()}</div>
        </Show>

        <Show when={!loading() && searched() && !error() && results().length === 0}>
          <div class="text-sm" style={{ color: "var(--color-text-muted)" }}>No results found.</div>
        </Show>

        <Show when={!loading() && results().length > 0}>
          <div class="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
            {results().length} result{results().length !== 1 ? "s" : ""}
          </div>
          <div class="space-y-3">
            <For each={results()}>
              {(result) => (
                <div
                  class="rounded-lg border p-4 cursor-pointer transition-colors"
                  style={{
                    "border-color": "var(--color-border)",
                    "background-color": "var(--color-bg-secondary)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-secondary)")}
                  onClick={() => handleSelect(result)}
                >
                  <div class="flex items-start justify-between gap-3 mb-1">
                    <span
                      class="font-medium text-sm"
                      style={{ color: "var(--color-accent)" }}
                    >
                      {result.title || result.path}
                    </span>
                    <span
                      class="text-xs shrink-0 px-1.5 py-0.5 rounded font-mono"
                      style={{
                        background: "var(--color-bg-surface)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      {result.score.toFixed(3)}
                    </span>
                  </div>
                  <div class="text-xs mb-2" style={{ color: "var(--color-text-muted)" }}>
                    {result.path}
                  </div>
                  <Show when={result.snippet}>
                    <p
                      class="text-sm leading-relaxed"
                      style={{
                        color: "var(--color-text-secondary)",
                        "white-space": "pre-wrap",
                        "word-break": "break-word",
                      }}
                    >
                      {result.snippet.length > 600
                        ? result.snippet.slice(0, 600) + "…"
                        : result.snippet}
                    </p>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
