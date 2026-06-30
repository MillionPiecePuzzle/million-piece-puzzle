import { readonly, ref } from "vue";

// "forced": a signed-in user choosing a missing country, cannot be dismissed
// until one is chosen. "guest": the second (minting) step of in-site guest
// onboarding, also non-dismissible. "edit": opened from the topbar to change an
// existing nationality, dismissible.
export type NationalityModalMode = "forced" | "edit" | "guest";

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
