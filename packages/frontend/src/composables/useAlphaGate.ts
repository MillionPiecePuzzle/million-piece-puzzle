const STORAGE_KEY = "mpp.alpha.passcode";

function expected(): string {
  return import.meta.env.VITE_ALPHA_PASSCODE ?? "alpha";
}

export function isAlphaUnlocked(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === expected();
  } catch {
    return false;
  }
}

export function tryUnlockAlpha(passcode: string): boolean {
  const trimmed = passcode.trim();
  if (trimmed !== expected()) return false;
  try {
    localStorage.setItem(STORAGE_KEY, trimmed);
  } catch {
    return false;
  }
  return true;
}

export function lockAlpha(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
