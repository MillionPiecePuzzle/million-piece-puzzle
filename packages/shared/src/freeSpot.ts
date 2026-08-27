// Where a cluster dropped on a HUD flag lands: the clear patch nearest the flag,
// searched outward from the flag itself. Shared because both ends run it, on the
// same rings, gap and centering: the client for the optimistic placement it shows
// on release, the server for the authoritative one, resolved against its own
// complete indexes rather than the board this client happens to have streamed.
// Where the client's knowledge is complete the two agree and the server's echo
// moves nothing.

export type Aabb = { minX: number; minY: number; maxX: number; maxY: number };

// Clear space kept on every side between the landed cluster and its neighbours,
// in pieces, and the rings the outward search is bounded to (20 rings, a 41x41
// patch area).
export const FLAG_DROP_GAP_PIECES = 0.15;
export const FLAG_DROP_SEARCH_RINGS = 20;

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
  // Optional harder constraint the last-resort landing honours too: a patch
  // failing it is skipped even when every ring is occupied. The server passes the
  // destination tile's piece cap here, since landing over that cap bounces the
  // drop back to where the cluster was picked up instead of honouring it.
  hasRoom?: (box: Aabb) => boolean;
};

// Origin that centers the cluster on the nearest clear patch to (atX, atY).
// Falls back to the nearest patch that only fails `isClear`, then to the flag's
// own patch: a crowded board still honours the drop rather than refusing it.
export function findFreeOrigin(search: FreeOriginSearch): { x: number; y: number } {
  const { bounds, atX, atY, gap, maxRing, clamp, isClear, hasRoom } = search;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  // A gap on either side: the occupancy test grows the cluster by `gap`, so a
  // shorter stride would put the next patch inside the grown box of the one it is
  // stepping away from and the search would skip a whole ring to clear it.
  const step = Math.max(w, h) + gap * 2;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  let crowded: { x: number; y: number } | null = null;
  for (const [ox, oy] of ringOffsets(maxRing)) {
    const origin = clamp(atX + ox * step - centerX, atY + oy * step - centerY);
    const box = paddedWorldBox(bounds, origin.x, origin.y, gap);
    if (hasRoom && !hasRoom(box)) continue;
    if (isClear(box)) return origin;
    crowded ??= origin;
  }
  return crowded ?? clamp(atX - centerX, atY - centerY);
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

// Whether two boxes in the same space overlap. Edge contact does not count, so a
// box resting exactly against another is clear of it.
export function boxesOverlap(a: Aabb, b: Aabb): boolean {
  return a.maxX > b.minX && a.minX < b.maxX && a.maxY > b.minY && a.minY < b.maxY;
}
