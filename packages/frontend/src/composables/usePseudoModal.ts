import { readonly, ref } from "vue";

// "forced": shown on first contribution, cannot be dismissed until a valid
// pseudo is entered. "edit": opened from the topbar to change an existing
// pseudo, dismissible.
export type PseudoModalMode = "forced" | "edit";

const open = ref(false);
const mode = ref<PseudoModalMode>("edit");

export function usePseudoModal() {
  return {
    open: readonly(open),
    mode: readonly(mode),
    show: (next: PseudoModalMode) => {
      mode.value = next;
      open.value = true;
    },
    hide: () => {
      open.value = false;
    },
  };
}
