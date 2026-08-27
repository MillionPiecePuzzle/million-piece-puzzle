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
  // Only the panels the player has decided about. An id absent here is on, and
  // stays absent, so a choice made on one screen never commits a default for
  // every other one.
  panels: Partial<Record<HudPanelId, boolean>>;
};

// The panels a compact viewport has room for (see `useCompactViewport`): the
// board-first pair a phone keeps when the HUD is cut down to the board. The
// other four are not drawn there and not offered in the options menu either, so
// a choice made on a desktop cannot bring one back onto a screen that cannot
// hold it.
const COMPACT_PANEL_IDS: readonly HudPanelId[] = ["reference", "minimap"];

const STORAGE_KEY = "mpp.display";

// On by default: the aid shows the same photo the board is made of, and left
// off it was a setting almost nobody opened the menu to find. A player who
// wants the bare board switches it off once, and that is the choice that
// persists.
export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  referenceUnderlay: true,
  panels: {},
};

function defaults(): DisplaySettings {
  return { referenceUnderlay: DEFAULT_DISPLAY_SETTINGS.referenceUnderlay, panels: {} };
}

export function isPanelAvailable(panel: HudPanelId, compact: boolean): boolean {
  return !compact || COMPACT_PANEL_IDS.includes(panel);
}

export function isPanelVisible(
  settings: DisplaySettings,
  panel: HudPanelId,
  compact: boolean,
): boolean {
  if (!isPanelAvailable(panel, compact)) return false;
  const chosen = settings.panels[panel];
  return typeof chosen === "boolean" ? chosen : true;
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
