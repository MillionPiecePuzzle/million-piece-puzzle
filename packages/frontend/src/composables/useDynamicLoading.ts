import { ref, watch } from "vue";

// Player preference (not session state, unlike the pin set itself): off
// restricts loading to locked pieces and pinned tiles everywhere the stage's
// residency logic would otherwise load content. Persisted like mpp.locale.
const STORAGE_KEY = "mpp.dynamicLoading";

function readInitial(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    // private mode or storage disabled: fall through to the default
  }
  return true;
}

const dynamicLoadingEnabled = ref(readInitial());

watch(dynamicLoadingEnabled, (enabled) => {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // best effort: the in-memory preference still switches
  }
});

export function useDynamicLoading() {
  return { dynamicLoadingEnabled };
}
