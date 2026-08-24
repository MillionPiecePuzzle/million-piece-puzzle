// Personal viewport flags: client-only bookmarks a player drops on the board to
// jump back to a spot while collecting pieces elsewhere. They never leave the
// browser (no protocol change, see DECISIONS), so the whole model lives here:
// the palette, the list rules and the localStorage codec, pure so the swap and
// cap rules are unit-tested without Vue or Pixi.

export type BoardFlag = {
  id: string;
  worldX: number;
  worldY: number;
  // Index into FLAG_COLORS, unique across the list: a flag taking a color
  // another one already holds swaps with it (recolorFlag), so the color alone
  // identifies a flag across the bar, the canvas and the minimap.
  color: number;
};

// Eight well-separated hues, deep enough to read over the paper backdrop and
// over photo pieces alike. Their count is the flag cap: one color per flag.
export const FLAG_COLORS = [
  "#d8453f",
  "#e08329",
  "#cfa81d",
  "#4f9d48",
  "#2b9a9a",
  "#3b7ad4",
  "#8659d0",
  "#d1509a",
] as const;

// i18n keys under `flags.colors`, so a swatch announces a color rather than an
// index to a screen reader.
export const FLAG_COLOR_KEYS = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;

export const MAX_FLAGS = FLAG_COLORS.length;

const STORAGE_PREFIX = "mpp.flags.";

let idCounter = 0;

// Unique within the browser session; flags are per-browser, so a counter paired
// with the mint time is enough and needs no secure-context crypto API.
function nextFlagId(): string {
  idCounter += 1;
  return `f${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function firstFreeColor(flags: readonly BoardFlag[]): number {
  const taken = new Set(flags.map((f) => f.color));
  for (let i = 0; i < MAX_FLAGS; i++) {
    if (!taken.has(i)) return i;
  }
  return -1;
}

export function addFlag(flags: readonly BoardFlag[], worldX: number, worldY: number): BoardFlag[] {
  const color = firstFreeColor(flags);
  if (color === -1) return [...flags];
  return [...flags, { id: nextFlagId(), worldX, worldY, color }];
}

export function removeFlag(flags: readonly BoardFlag[], id: string): BoardFlag[] {
  return flags.filter((f) => f.id !== id);
}

export function moveFlag(
  flags: readonly BoardFlag[],
  id: string,
  worldX: number,
  worldY: number,
): BoardFlag[] {
  return flags.map((f) => (f.id === id ? { ...f, worldX, worldY } : f));
}

// Colors stay a permutation: whoever holds the requested color takes the one
// being given up, so no two flags ever share a color and none is left blank.
export function recolorFlag(flags: readonly BoardFlag[], id: string, color: number): BoardFlag[] {
  const target = flags.find((f) => f.id === id);
  if (!target || color < 0 || color >= MAX_FLAGS || target.color === color) return [...flags];
  return flags.map((f) => {
    if (f.id === id) return { ...f, color };
    if (f.color === color) return { ...f, color: target.color };
    return f;
  });
}

export function flagStorageKey(puzzleId: string): string {
  return `${STORAGE_PREFIX}${puzzleId}`;
}

// localStorage is player-editable and survives a board switch, so a stored list
// is treated as untrusted input: entries that are not placeable points are
// dropped, colors are forced back into a duplicate-free permutation, and the
// list is cut to the cap.
export function parseFlags(raw: string | null): BoardFlag[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const flags: BoardFlag[] = [];
  const takenIds = new Set<string>();
  const takenColors = new Set<number>();
  for (const entry of parsed) {
    if (flags.length >= MAX_FLAGS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const { id, worldX, worldY, color } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || takenIds.has(id)) continue;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) continue;
    const wantedColor =
      typeof color === "number" && Number.isInteger(color) && color >= 0 && color < MAX_FLAGS
        ? color
        : -1;
    const resolved = wantedColor === -1 || takenColors.has(wantedColor) ? -1 : wantedColor;
    flags.push({
      id,
      worldX: worldX as number,
      worldY: worldY as number,
      color: resolved,
    });
    takenIds.add(id);
    if (resolved !== -1) takenColors.add(resolved);
  }
  for (const flag of flags) {
    if (flag.color === -1) flag.color = firstFreeColor(flags);
  }
  return flags;
}

export function readFlags(puzzleId: string): BoardFlag[] {
  try {
    return parseFlags(localStorage.getItem(flagStorageKey(puzzleId)));
  } catch {
    return [];
  }
}

export function writeFlags(puzzleId: string, flags: readonly BoardFlag[]): void {
  try {
    if (flags.length === 0) localStorage.removeItem(flagStorageKey(puzzleId));
    else localStorage.setItem(flagStorageKey(puzzleId), JSON.stringify(flags));
  } catch {
    // Private mode or storage disabled: flags stay live for this session only.
  }
}
