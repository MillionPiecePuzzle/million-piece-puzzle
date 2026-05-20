import { readonly, ref } from "vue";

// The pseudo is anonymous and not stored server-side. localStorage keeps it so
// a returning contributor keeps the same identity across reloads.
const STORAGE_KEY = "mpp.pseudo";

function readStored(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

const pseudo = ref<string | null>(readStored());

export function usePseudo() {
  function setPseudo(next: string): void {
    pseudo.value = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable (private mode, disabled): the pseudo still
      // lives in memory for this session.
    }
  }

  return {
    pseudo: readonly(pseudo),
    setPseudo,
  };
}
