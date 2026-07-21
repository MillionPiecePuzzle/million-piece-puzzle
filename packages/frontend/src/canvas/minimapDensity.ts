import type { MinimapSnapshot } from "./puzzleStage";

// Server-computed density grid: the global overview, decoupled from the
// (partial) local board. Loose cells in a light ink, locked cells darker on
// top, alpha scaled by per-cell count so denser cells read stronger. The local
// known-region overlay (drawn by the caller afterwards) takes precedence over
// this. A +1 px on each cell closes hairline seams between neighbours. Loose
// and locked scale against their own independent maxima (not a shared one):
// loose pieces vastly outnumber locked ones for most of the puzzle's life, so
// a shared max would dilute a handful of locked pieces to near-invisible
// alpha. Shared by MiniMap.vue and MinimapModal.vue, each with its own
// projection (toX/toY/scale) into the target canvas. See DECISIONS.
export function paintDensityGrid(
  ctx: CanvasRenderingContext2D,
  snap: MinimapSnapshot,
  toX: (wx: number) => number,
  toY: (wy: number) => number,
  scale: number,
): void {
  const grid = snap.grid;
  if (!grid || grid.cols <= 0 || grid.rows <= 0) return;

  let maxLoose = 1;
  let maxLocked = 1;
  for (let i = 0; i < grid.cols * grid.rows; i++) {
    const lo = grid.loose[i] ?? 0;
    const lk = grid.locked[i] ?? 0;
    if (lo > maxLoose) maxLoose = lo;
    if (lk > maxLocked) maxLocked = lk;
  }
  const cellPxW = grid.cellW * scale + 1;
  const cellPxH = grid.cellH * scale + 1;
  const paint = (counts: number[], max: number, base: number, span: number) => {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const idx = r * grid.cols + c;
        // Skip cells the live overlay already covers, so a stale server count
        // never shows under a region the client knows fresh.
        if (snap.knownCells.has(idx)) continue;
        const n = counts[idx] ?? 0;
        if (n <= 0) continue;
        const x = toX(grid.originX + c * grid.cellW);
        const y = toY(grid.originY + r * grid.cellH);
        ctx.fillStyle = `rgba(21,20,15,${(base + span * (n / max)).toFixed(3)})`;
        ctx.fillRect(x, y, cellPxW, cellPxH);
      }
    }
  };
  paint(grid.loose, maxLoose, 0.08, 0.32);
  paint(grid.locked, maxLocked, 0.2, 0.55);
}
