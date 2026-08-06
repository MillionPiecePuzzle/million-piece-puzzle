import { nextTick, onBeforeUnmount, type Ref } from "vue";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface FocusTrapOptions {
  onEscape: () => void;
  autoFocus?: boolean;
}

// Tab-cycling, Escape-to-close and return-to-trigger for a modal dialog.
// Emit-owned modals (mounted/unmounted by a parent's v-if) call activate from
// onMounted and get deactivate for free via this composable's own
// onBeforeUnmount below. Composable-owned modals (always mounted, toggled via
// an internal `open` ref) call activate/deactivate from a watch(open, ...)
// at the call site instead.
export function useFocusTrap(containerEl: Ref<HTMLElement | null>, options: FocusTrapOptions) {
  const autoFocus = options.autoFocus ?? true;
  let triggerEl: HTMLElement | null = null;
  let active = false;

  function focusables(): HTMLElement[] {
    const root = containerEl.value;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      options.onEscape();
      return;
    }
    if (e.key !== "Tab") return;
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function activate(): void {
    if (active) return;
    active = true;
    triggerEl = document.activeElement as HTMLElement | null;
    window.addEventListener("keydown", onKeydown);
    if (autoFocus) void nextTick(() => focusables()[0]?.focus());
  }

  function deactivate(): void {
    if (!active) return;
    active = false;
    window.removeEventListener("keydown", onKeydown);
    if (triggerEl && document.body.contains(triggerEl)) triggerEl.focus();
    triggerEl = null;
  }

  onBeforeUnmount(deactivate);

  return { activate, deactivate };
}
