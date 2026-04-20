import { createSignal, For, Show } from "solid-js";

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
  readOnly?: boolean;
}

/**
 * Tag editor: chips for existing tags with a click-to-remove X, plus an
 * input that accepts new tags on Enter or comma. Backspace on an empty
 * input removes the last tag so keyboard-only editing feels natural.
 */
export default function TagInput(props: Props) {
  const [draft, setDraft] = createSignal("");

  function addTag(raw: string) {
    const next = raw.trim().replace(/^#/, "");
    if (!next) return;
    if (props.tags.includes(next)) {
      setDraft("");
      return;
    }
    props.onChange([...props.tags, next]);
    setDraft("");
  }

  function removeTag(tag: string) {
    props.onChange(props.tags.filter((t) => t !== tag));
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(draft());
    } else if (e.key === "Backspace" && draft() === "" && props.tags.length > 0) {
      e.preventDefault();
      removeTag(props.tags[props.tags.length - 1]!);
    }
  }

  function handleBlur() {
    if (draft().trim()) addTag(draft());
  }

  return (
    <div
      class="flex items-center gap-2 flex-wrap rounded px-2 py-1 border"
      style={{
        "background-color": "var(--color-bg-surface)",
        "border-color": "var(--color-border)",
      }}
    >
      <For each={props.tags}>
        {(tag) => (
          <span
            class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded"
            style={{ background: "var(--color-bg-hover)", color: "var(--color-accent)" }}
          >
            <span>{tag}</span>
            <Show when={!props.readOnly}>
              <button
                type="button"
                onClick={() => removeTag(tag)}
                class="cursor-pointer leading-none"
                style={{ color: "var(--color-text-muted)" }}
                title={`Remove ${tag}`}
              >
                ×
              </button>
            </Show>
          </span>
        )}
      </For>
      <Show when={!props.readOnly}>
        <input
          type="text"
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={props.tags.length === 0 ? "Add tags (Enter or ,)" : "Add tag…"}
          class="flex-1 min-w-[8ch] bg-transparent border-none outline-none text-sm"
          style={{ color: "var(--color-text-primary)" }}
        />
      </Show>
    </div>
  );
}
