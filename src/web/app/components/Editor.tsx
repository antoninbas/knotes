import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { notes, type NoteResult } from "../lib/api.ts";
import { EditorView, keymap, placeholder, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { theme } from "../lib/theme.ts";
import TagInput from "./TagInput.tsx";

const AUTOSAVE_DELAY_MS = 1500;

interface Props {
  note: NoteResult;
  onSave: (updated: NoteResult) => void;
}

function createEditorTheme(isDark: boolean) {
  return EditorView.theme({
    "&": {
      backgroundColor: isDark ? "#313244" : "#ccd0da",
      color: isDark ? "#cdd6f4" : "#4c4f69",
      borderRadius: "6px",
      border: `1px solid ${isDark ? "#45475a" : "#bcc0cc"}`,
      fontSize: "14px",
    },
    ".cm-content": {
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      padding: "12px 0",
      caretColor: isDark ? "#89b4fa" : "#1e66f5",
    },
    ".cm-cursor": {
      borderLeftColor: isDark ? "#89b4fa" : "#1e66f5",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: isDark ? "#45475a" : "#bcc0cc",
    },
    ".cm-activeLine": {
      backgroundColor: isDark ? "rgba(69, 71, 90, 0.4)" : "rgba(188, 192, 204, 0.4)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: isDark ? "rgba(69, 71, 90, 0.4)" : "rgba(188, 192, 204, 0.4)",
    },
    ".cm-gutters": {
      backgroundColor: isDark ? "#1e1e2e" : "#e6e9ef",
      color: isDark ? "#6c7086" : "#8c8fa1",
      border: "none",
      borderRight: `1px solid ${isDark ? "#45475a" : "#bcc0cc"}`,
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 8px",
    },
    ".cm-scroller": {
      overflow: "auto",
    },
  }, { dark: isDark });
}

export default function Editor(props: Props) {
  let containerRef: HTMLDivElement | undefined;
  let editorView: EditorView | undefined;
  const [title, setTitle] = createSignal(props.note.title);
  const [tags, setTags] = createSignal<string[]>(props.note.tags);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [saveStatus, setSaveStatus] = createSignal<"saved" | "saving" | "unsaved">("saved");

  // Mutable refs — not signals, no reactivity needed
  let currentContent = props.note.content;
  let isDirty = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleSave() {
    isDirty = true;
    setSaveStatus("unsaved");
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(autoSave, AUTOSAVE_DELAY_MS);
  }

  /** Auto-save: saves silently, does not switch to view mode. */
  async function autoSave() {
    debounceTimer = null;
    if (!isDirty) return;
    isDirty = false;
    setSaveStatus("saving");
    try {
      await notes.update(props.note.path, { title: title(), content: currentContent, tags: tags() });
      setSaveStatus("saved");
    } catch {
      isDirty = true;
      setSaveStatus("unsaved");
    }
  }

  function insertTodoList() {
    if (!editorView) return;
    const snippet = "- [ ] \n- [ ] \n- [ ] \n";
    const pos = editorView.state.selection.main.head;
    editorView.dispatch({
      changes: { from: pos, insert: snippet },
      selection: { anchor: pos + 6 }, // place cursor after "- [ ] " on first line
    });
    editorView.focus();
  }

  /** Manual save: cancels pending auto-save, saves immediately, switches to view mode. */
  async function handleSave() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    isDirty = false;
    setSaving(true);
    setSaveStatus("saving");
    setError(null);
    try {
      const updated = await notes.update(props.note.path, {
        title: title(),
        content: currentContent,
        tags: tags(),
      });
      setSaveStatus("saved");
      props.onSave(updated);
    } catch (err: any) {
      isDirty = true;
      setError(err.message);
      setSaveStatus("unsaved");
    } finally {
      setSaving(false);
    }
  }

  onMount(() => {
    if (!containerRef) return;

    const isDark = theme() !== "light";

    const saveKeymap = keymap.of([{
      key: "Mod-s",
      run: () => { handleSave(); return true; },
    }]);

    const state = EditorState.create({
      doc: props.note.content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        createEditorTheme(isDark),
        saveKeymap,
        keymap.of([
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...closeBracketsKeymap,
        ]),
        placeholder("Write your note in markdown..."),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            currentContent = update.state.doc.toString();
            scheduleSave();
          }
        }),
        EditorView.lineWrapping,
      ],
    });

    editorView = new EditorView({
      state,
      parent: containerRef,
    });

    editorView.focus();

    // Save when the tab is hidden (user switches tabs, minimises, or closes the window)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && isDirty) {
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        autoSave();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    onCleanup(() => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    });
  });

  onCleanup(() => {
    // Flush any pending auto-save when navigating away
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (isDirty) {
      notes
        .update(props.note.path, { title: title(), content: currentContent, tags: tags() })
        .catch(() => {});
    }
    editorView?.destroy();
  });

  return (
    <div class="max-w-4xl mx-auto space-y-4">
      <input
        type="text"
        value={title()}
        onInput={(e) => { setTitle(e.currentTarget.value); scheduleSave(); }}
        class="w-full text-2xl font-bold bg-transparent border-none outline-none"
        style={{ color: "var(--color-text-primary)" }}
        placeholder="Note title"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            handleSave();
          }
        }}
      />
      <TagInput
        tags={tags()}
        onChange={(next) => {
          setTags(next);
          scheduleSave();
        }}
      />
      <div class="flex gap-2">
        <button
          onClick={insertTodoList}
          class="px-2 py-1 text-xs rounded cursor-pointer"
          style={{ background: "var(--color-bg-surface)", color: "var(--color-text-secondary)" }}
          title="Insert a GFM task list"
        >
          &#9634; Todo list
        </button>
      </div>
      <div
        ref={containerRef}
        class="min-h-[60vh] rounded overflow-hidden"
      />
      <div class="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving()}
          class="px-4 py-2 rounded text-sm font-medium cursor-pointer disabled:opacity-50"
          style={{ background: "var(--color-accent)", color: "#fff" }}
        >
          {saving() ? "Saving..." : "Save (Ctrl+S)"}
        </button>
        <span class="text-xs" style={{ color: "var(--color-text-muted)" }}>
          <Show when={saveStatus() === "unsaved"}>Unsaved changes</Show>
          <Show when={saveStatus() === "saving" && !saving()}>Saving...</Show>
          <Show when={saveStatus() === "saved"}>Saved</Show>
        </span>
        <Show when={error()}>
          <span class="text-sm" style={{ color: "var(--color-danger)" }}>
            {error()}
          </span>
        </Show>
      </div>
    </div>
  );
}
