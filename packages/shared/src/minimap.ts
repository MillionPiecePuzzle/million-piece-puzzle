// A downsampled density grid of the whole board for the minimap overview. Each
// cell carries the count of loose and locked pieces whose body center falls in
// it, row-major over cols*rows cells. The server computes it once per keyframe;
// the contributor renders this global overview decoupled from its (now partial)
// local board, and the spectator reads the same grid from the keyframe. Cells
// are roughly square, with the larger play-zone axis split into MINIMAP_TARGET_CELLS.

import type { GroupRuntime, PieceRuntime } from "./piece.js";
import type { PlayZone } from "./playzone.js";

export type MinimapGrid = {
  cols: number;
  rows: number;
  originX: number;
  originY: number;
  cellW: number;
  cellH: number;
  // Per-cell piece counts, row-major (index = row * cols + col), each cols*rows long.
  loose: number[];
  locked: number[];
};

const MINIMAP_TARGET_CELLS = 96;

// Bins every piece into a play-zone-aligned grid by its body center, splitting
// loose from locked so the map reads progress. Pure: drives both the keyframe
// build and the periodic WS `minimap` broadcast off the same already-read board.
// A piece references its group for the live origin; its solved cell (id % cols,
// id / cols) gives the body offset, so the world center is origin + offset + half.
export function buildMinimapGrid(
  pieces: readonly PieceRuntime[],
  groups: readonly GroupRuntime[],
  gridCols: number,
  pieceSize: number,
  playZone: PlayZone,
): MinimapGrid {
  const zoneW = Math.max(1, playZone.maxX - playZone.minX);
  const zoneH = Math.max(1, playZone.maxY - playZone.minY);
  const cell = Math.max(zoneW, zoneH) / MINIMAP_TARGET_CELLS;
  const cols = Math.max(1, Math.round(zoneW / cell));
  const rows = Math.max(1, Math.round(zoneH / cell));
  const cellW = zoneW / cols;
  const cellH = zoneH / rows;
  const loose = new Array<number>(cols * rows).fill(0);
  const locked = new Array<number>(cols * rows).fill(0);
  const groupById = new Map<number, GroupRuntime>();
  for (const g of groups) groupById.set(g.id, g);
  const half = pieceSize / 2;
  for (const p of pieces) {
    const g = groupById.get(p.groupId);
    if (!g) continue;
    const wx = g.worldX + (p.id % gridCols) * pieceSize + half;
    const wy = g.worldY + Math.floor(p.id / gridCols) * pieceSize + half;
    let cx = Math.floor((wx - playZone.minX) / cellW);
    let cy = Math.floor((wy - playZone.minY) / cellH);
    if (cx < 0) cx = 0;
    else if (cx >= cols) cx = cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= rows) cy = rows - 1;
    const idx = cy * cols + cx;
    if (g.locked) locked[idx] = locked[idx]! + 1;
    else loose[idx] = loose[idx]! + 1;
  }
  return {
    cols,
    rows,
    originX: playZone.minX,
    originY: playZone.minY,
    cellW,
    cellH,
    loose,
    locked,
  };
}
