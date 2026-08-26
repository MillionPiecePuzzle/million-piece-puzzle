// The newest release this browser has been shown the notes for. Per browser
// like the display preferences: a changelog is not worth a round trip, and a
// player who reads it on their phone reading it again on their laptop costs
// them one click.
const STORAGE_KEY = "mpp.updatesSeen";

// localStorage is player-editable, so a stored value is untrusted input. A
// value that is not a version falls back to "nothing stored", which seeds
// rather than marks unseen: a mangled key must never invent a release.
const VERSION_PATTERN = /^\d+(\.\d+){0,2}$/;

export function parseSeenVersion(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return VERSION_PATTERN.test(trimmed) ? trimmed : null;
}

// Equality against the newest version rather than an ordering, since the only
// move this has to catch is a release published after the last one read.
export function hasUnseenRelease(seen: string | null, latest: string): boolean {
  return seen !== null && seen !== latest;
}

export function readSeenVersion(): string | null {
  try {
    return parseSeenVersion(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeSeenVersion(version: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, version);
  } catch {
    // Private mode or storage disabled: the notes read as new again next visit.
  }
}
