// localStorage wrapped to no-op on any failure (private mode, storage
// disabled, quota), so a preference read/write never throws into its caller.

export function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // best effort: the caller's in-memory state still switches
  }
}
