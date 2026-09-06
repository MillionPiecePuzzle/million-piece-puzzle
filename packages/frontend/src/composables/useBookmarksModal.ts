import { readonly, ref } from "vue";
import { useModal } from "./useModal";
import type { NewBookmark } from "../data/bookmarks";

const modal = useModal();
// How far the control that opened the notebook sits from the right edge of the
// viewport, measured at the click. The panel hangs off that same edge, so this
// is all it needs to grow out of the button instead of out of a corner.
const anchorInset = ref<number | null>(null);
// The control the panel hangs off, kept for as long as it is open: it closes
// what it opened by toggling, so the press that closes the notebook from outside
// has to leave that one control alone or the click behind it would reopen it.
const anchorEl = ref<HTMLElement | null>(null);
// A bookmark someone handed this player in a link, waiting for the notebook to
// open on it. It is a draft and never an entry: the panel fills its fields with
// it, and only the recipient's own save writes it. Taken rather than read, so a
// draft is offered once and a later open shows the list.
const draft = ref<NewBookmark | null>(null);

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
    showDraft(entry: NewBookmark): void {
      draft.value = entry;
      anchorInset.value = null;
      anchorEl.value = null;
      modal.show();
    },
    takeDraft(): NewBookmark | null {
      const entry = draft.value;
      draft.value = null;
      return entry;
    },
  };
}
