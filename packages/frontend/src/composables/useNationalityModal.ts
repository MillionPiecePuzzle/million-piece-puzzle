import { readonly, ref } from "vue";

// "forced": shown right after the pseudo on first contribution, cannot be
// dismissed until a nationality is chosen. "edit": opened from the topbar to
// change an existing nationality, dismissible.
export type NationalityModalMode = "forced" | "edit";

const open = ref(false);
const mode = ref<NationalityModalMode>("edit");

export function useNationalityModal() {
  return {
    open: readonly(open),
    mode: readonly(mode),
    show: (next: NationalityModalMode) => {
      mode.value = next;
      open.value = true;
    },
    hide: () => {
      open.value = false;
    },
  };
}
