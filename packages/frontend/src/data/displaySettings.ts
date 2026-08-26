// Player display preferences: how the board is drawn, not what is on it. Per
// browser and shared by every puzzle (unlike the personal flags, which are
// keyed by puzzle id), since a preference about rendering carries over to
// whatever board the player opens next.
export const HUD_PANEL_IDS = [
  "reference",
  "zoom",
  "activity",
  "leaderboard",
  "minimap",
  "flags",
] as const;

export type HudPanelId = (typeof HUD_PANEL_IDS)[number];

export type DisplaySettings = {
  referenceUnderlay: boolean;
  // Only the panels the player has decided about. An id absent here follows the
  // viewport default below, so a phone still gets the board-first HUD and a
  // widening viewport still brings the rest back on its own.
  panels: Partial<Record<HudPanelId, boolean>>;
};

// What a narrow viewport shows on its own: the two panels a phone kept when the
// HUD was cut down to the board (see DECISIONS). Every panel is on by default
// above the breakpoint.
const NARROW_DEFAULT_PANELS: readonly HudPanelId[] = ["reference", "minimap"];

const STORAGE_KEY = "mpp.display";

// Off by default: the underlay is an aid, so the board a player has never
// touched a setting for stays the one every screenshot and every explanation
// of the game shows.
export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  referenceUnderlay: false,
  panels: {},
};

function defaults(): DisplaySettings {
  return { referenceUnderlay: DEFAULT_DISPLAY_SETTINGS.referenceUnderlay, panels: {} };
}

export function isPanelVisible(
  settings: DisplaySettings,
  panel: HudPanelId,
  wide: boolean,
): boolean {
  const chosen = settings.panels[panel];
  if (typeof chosen === "boolean") return chosen;
  return wide || NARROW_DEFAULT_PANELS.includes(panel);
}

function parsePanels(raw: unknown): Partial<Record<HudPanelId, boolean>> {
  if (typeof raw !== "object" || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const panels: Partial<Record<HudPanelId, boolean>> = {};
  for (const id of HUD_PANEL_IDS) {
    const value = source[id];
    if (typeof value === "boolean") panels[id] = value;
  }
  return panels;
}

// localStorage is player-editable, so a stored value is untrusted input: any
// key that is not a boolean falls back to its default instead of reaching the
// canvas as an arbitrary value.
export function parseDisplaySettings(raw: string | null): DisplaySettings {
  if (!raw) return defaults();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults();
  }
  if (typeof parsed !== "object" || parsed === null) return defaults();
  const { referenceUnderlay, panels } = parsed as Record<string, unknown>;
  return {
    referenceUnderlay:
      typeof referenceUnderlay === "boolean"
        ? referenceUnderlay
        : DEFAULT_DISPLAY_SETTINGS.referenceUnderlay,
    panels: parsePanels(panels),
  };
}

export function readDisplaySettings(): DisplaySettings {
  try {
    return parseDisplaySettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaults();
  }
}

export function writeDisplaySettings(settings: DisplaySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or storage disabled: the choice holds for this session only.
  }
}
