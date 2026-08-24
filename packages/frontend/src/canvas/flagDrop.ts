// Where a cluster dropped on a HUD flag button lands: a clear patch beside the
// flag, searched outward from the flag itself. Kept free of Pixi and of the
// stage's own state so the search can be unit tested; the caller supplies the
// play-zone clamp and the occupancy test, which are the only parts that need the
// board.

import type { Aabb } from "./cull";

// One HUD flag button as a drop target, in client coordinates: the one frame the
// DOM bar and the canvas both speak. Measured by the bar, hit-tested by the stage.
export type FlagDropTarget = { id: string; rect: DOMRect };
export type FlagDropTargetSource = () => FlagDropTarget[];

// Candidate patches in an expanding square ring around the flag: the flag's own
// patch first, then the border of the 3x3 block of patches around it, then of the
// 5x5, and so on, so the clear patch nearest the flag wins. Each ring's border is
// walked nearest-first, which on a ring is the four sides before the corners:
// without it a taken patch sends the cluster diagonally, visibly further from the
// flag than it needed to go.
export function* ringOffsets(maxRing: number): Generator<readonly [number, number]> {
  yield [0, 0];
  for (let r = 1; r <= maxRing; r++) {
    const border: [number, number][] = [];
    for (let x = -r; x <= r; x++) border.push([x, -r], [x, r]);
    for (let y = -r + 1; y <= r - 1; y++) border.push([-r, y], [r, y]);
    border.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
    yield* border;
  }
}

export type FreeOriginSearch = {
  // Cluster bounds relative to its own origin, which is what the search returns.
  bounds: Aabb;
  // World point to land beside: the flag's foot.
  atX: number;
  atY: number;
  // Clear space kept on every side between the landed cluster and its neighbours.
  gap: number;
  // Rings tried before giving up and landing on the flag regardless.
  maxRing: number;
  // Pulls a candidate origin back inside the play zone. Applied before the
  // occupancy test, so a candidate the clamp moved is never reported clear on a
  // patch it does not actually occupy.
  clamp: (x: number, y: number) => { x: number; y: number };
  isClear: (box: Aabb) => boolean;
};

// Origin that centers the cluster on the nearest clear patch to (atX, atY).
// Falls back to the flag's own patch when every ring is occupied: a crowded board
// still honours the drop rather than refusing it.
export function findFreeOrigin(search: FreeOriginSearch): { x: number; y: number } {
  const { bounds, atX, atY, gap, maxRing, clamp, isClear } = search;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  // A gap on either side: the occupancy test grows the cluster by `gap`, so a
  // shorter stride would put the next patch inside the grown box of the one it is
  // stepping away from and the search would skip a whole ring to clear it.
  const step = Math.max(w, h) + gap * 2;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  for (const [ox, oy] of ringOffsets(maxRing)) {
    const origin = clamp(atX + ox * step - centerX, atY + oy * step - centerY);
    if (isClear(paddedWorldBox(bounds, origin.x, origin.y, gap))) return origin;
  }
  return clamp(atX - centerX, atY - centerY);
}

// Local bounds translated to a world origin and grown by the clearance gap.
export function paddedWorldBox(bounds: Aabb, x: number, y: number, pad: number): Aabb {
  return {
    minX: x + bounds.minX - pad,
    minY: y + bounds.minY - pad,
    maxX: x + bounds.maxX + pad,
    maxY: y + bounds.maxY + pad,
  };
}
