import { readonly, ref } from "vue";
import { useModal } from "./useModal";

const modal = useModal();
// How far the control that opened the notebook sits from the right edge of the
// viewport, measured at the click. The panel hangs off that same edge, so this
// is all it needs to grow out of the button instead of out of a corner.
const anchorInset = ref<number | null>(null);
// The control the panel hangs off, kept for as long as it is open: it closes
// what it opened by toggling, so the press that closes the notebook from outside
// has to leave that one control alone or the click behind it would reopen it.
const anchorEl = ref<HTMLElement | null>(null);

function showFrom(el: HTMLElement | null): void {
  const rect = el?.getBoundingClientRect();
  anchorInset.value = rect ? window.innerWidth - (rect.left + rect.width / 2) : null;
  anchorEl.value = el;
  modal.show();
}

export function useBookmarksModal() {
  return {
    ...modal,
    anchorInset: readonly(anchorInset),
    showFrom,
    toggleFrom(el: HTMLElement | null): void {
      if (modal.open.value) modal.hide();
      else showFrom(el);
    },
    pressedAnchor(target: Node): boolean {
      return anchorEl.value?.contains(target) ?? false;
    },
  };
}
