import { readonly, ref } from "vue";

// "forced": a signed-in user setting a missing pseudo, cannot be dismissed until
// a valid one is entered. "guest": the first step of in-site guest onboarding
// (no session yet), also non-dismissible. "edit": opened from the topbar to
// change an existing pseudo, dismissible.
export type PseudoModalMode = "forced" | "edit" | "guest";

const open = ref(false);
const mode = ref<PseudoModalMode>("edit");
// Optional i18n key shown as the field error when the modal opens, used to send
// a guest back here after a taken-pseudo 409 at mint.
const initialError = ref<string | null>(null);

export function usePseudoModal() {
  return {
    open: readonly(open),
    mode: readonly(mode),
    initialError: readonly(initialError),
    show: (next: PseudoModalMode, opts?: { error?: string | null }) => {
      mode.value = next;
      initialError.value = opts?.error ?? null;
      open.value = true;
    },
    hide: () => {
      open.value = false;
    },
  };
}
