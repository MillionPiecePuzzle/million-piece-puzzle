// The play zone: the world-space rectangle a puzzle is bounded to. The server
// computes it once from the initial scatter and sends it in the welcome
// message, so every client of a puzzle shares the exact same bound (camera
// limits, the held-piece clamp, and the minimap extent all derive from it).

export type PlayZone = { minX: number; minY: number; maxX: number; maxY: number };

// World-space grid cell. The /play backdrop draws a hairline grid at this
// pitch and the play zone half-extents are snapped to it, so the backdrop
// boundary always falls on a grid line.
export const GRID_WORLD_CELL = 80;

// Fraction of the raw union's larger side added as breathing room, so pieces
// scattered against the raw bound still have space to be dragged outward.
const PLAY_ZONE_MARGIN_FRACTION = 0.5;

// Builds the play zone from the puzzle frame (0,0)-(frameW,frameH) and every
// piece's world-space bounding rectangle. The raw union of the frame and the
// pieces is widened by a margin, then mirrored around the frame center so the
// frame stays centered, with the symmetric half-extent snapped outward to the
// world grid.
export function computePlayZone(
  frameW: number,
  frameH: number,
  pieceBounds: readonly PlayZone[],
): PlayZone {
  let minX = 0;
  let minY = 0;
  let maxX = frameW;
  let maxY = frameH;
  for (const b of pieceBounds) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  const margin = Math.max(maxX - minX, maxY - minY) * PLAY_ZONE_MARGIN_FRACTION;
  const cx = frameW / 2;
  const cy = frameH / 2;
  const snap = (half: number): number => Math.ceil(half / GRID_WORLD_CELL) * GRID_WORLD_CELL;
  const halfX = snap(Math.max(cx - minX, maxX - cx) + margin);
  const halfY = snap(Math.max(cy - minY, maxY - cy) + margin);
  return {
    minX: cx - halfX,
    minY: cy - halfY,
    maxX: cx + halfX,
    maxY: cy + halfY,
  };
}
