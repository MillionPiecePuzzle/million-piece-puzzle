// Player display preferences: how the board is drawn, not what is on it. Per
// browser and shared by every puzzle (unlike the personal flags, which are
// keyed by puzzle id), since a preference about rendering carries over to
// whatever board the player opens next.
export type DisplaySettings = {
  referenceUnderlay: boolean;
};

const STORAGE_KEY = "mpp.display";

// Off by default: the underlay is an aid, so the board a player has never
// touched a setting for stays the one every screenshot and every explanation
// of the game shows.
export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  referenceUnderlay: false,
};

// localStorage is player-editable, so a stored value is untrusted input: any
// key that is not a boolean falls back to its default instead of reaching the
// canvas as an arbitrary value.
export function parseDisplaySettings(raw: string | null): DisplaySettings {
  if (!raw) return { ...DEFAULT_DISPLAY_SETTINGS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_DISPLAY_SETTINGS };
  }
  if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_DISPLAY_SETTINGS };
  const { referenceUnderlay } = parsed as Record<string, unknown>;
  return {
    referenceUnderlay:
      typeof referenceUnderlay === "boolean"
        ? referenceUnderlay
        : DEFAULT_DISPLAY_SETTINGS.referenceUnderlay,
  };
}

export function readDisplaySettings(): DisplaySettings {
  try {
    return parseDisplaySettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_DISPLAY_SETTINGS };
  }
}

export function writeDisplaySettings(settings: DisplaySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or storage disabled: the choice holds for this session only.
  }
}
