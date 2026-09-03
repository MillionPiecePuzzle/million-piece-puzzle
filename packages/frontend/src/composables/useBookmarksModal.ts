import { readonly, ref } from "vue";
import { useModal } from "./useModal";

const modal = useModal();
// How far the control that opened the notebook sits from the right edge of the
// viewport, measured at the click. The panel hangs off that same edge, so this
// is all it needs to grow out of the button instead of out of a corner.
const anchorInset = ref<number | null>(null);

export function useBookmarksModal() {
  return {
    ...modal,
    anchorInset: readonly(anchorInset),
    showFrom(el: HTMLElement | null): void {
      const rect = el?.getBoundingClientRect();
      anchorInset.value = rect ? window.innerWidth - (rect.left + rect.width / 2) : null;
      modal.show();
    },
  };
}
