import { ref, watch } from "vue";
import { readLocalStorage, writeLocalStorage } from "../data/safeLocalStorage";

// Player preference (not session state, unlike the pin set itself): off
// restricts loading to locked pieces and pinned tiles everywhere the stage's
// residency logic would otherwise load content. Persisted like mpp.locale.
const STORAGE_KEY = "mpp.dynamicLoading";

function readInitial(): boolean {
  const stored = readLocalStorage(STORAGE_KEY);
  return stored === null ? false : stored === "1";
}

const dynamicLoadingEnabled = ref(readInitial());

watch(dynamicLoadingEnabled, (enabled) => {
  writeLocalStorage(STORAGE_KEY, enabled ? "1" : "0");
});

export function useDynamicLoading() {
  return { dynamicLoadingEnabled };
}
