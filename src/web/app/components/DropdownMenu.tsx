import { createSignal, For, Show, onCleanup } from "solid-js";

export interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface Props {
  items: MenuItem[];
}

export default function DropdownMenu(props: Props) {
  const [open, setOpen] = createSignal(false);
  let menuRef: HTMLDivElement | undefined;

  function handleClickOutside(e: MouseEvent) {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      setOpen(false);
    }
  }

  function toggle() {
    const willOpen = !open();
    setOpen(willOpen);
    if (willOpen) {
      document.addEventListener("click", handleClickOutside, { once: true });
    }
  }

  onCleanup(() => {
    document.removeEventListener("click", handleClickOutside);
  });

  return (
    <div class="relative" ref={menuRef}>
      <button
        onClick={toggle}
        class="w-7 h-7 text-sm rounded transition-colors cursor-pointer flex items-center justify-center"
        style={{
          background: "var(--color-bg-surface)",
          color: "var(--color-text-muted)",
        }}
        title="More actions"
      >
        &#8942;
      </button>
      <Show when={open()}>
        <div
          class="absolute right-0 top-full mt-1 rounded-lg shadow-lg border py-1 min-w-[160px] z-50"
          style={{
            background: "var(--color-bg-secondary)",
            "border-color": "var(--color-border)",
          }}
        >
          <For each={props.items}>
            {(item) => (
              <button
                onClick={() => {
                  if (!item.disabled) {
                    setOpen(false);
                    item.onClick();
                  }
                }}
                disabled={item.disabled}
                class="w-full text-left px-4 py-2 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-default transition-colors"
                style={{ color: "var(--color-text-secondary)" }}
                onMouseEnter={(e) => {
                  if (!item.disabled) e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
