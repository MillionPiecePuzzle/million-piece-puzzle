// Pure decision helpers for the per-frame reconcile in puzzleStage, kept free of
// Pixi so they can be unit tested in isolation. The stage gathers the Pixi-coupled
// facts (ring membership, tile readiness, hydration state) and feeds them here.

import { cellKeysForRect, type CellKey } from "./groupGrid";
import type { Aabb } from "./cull";

// The set of grid cells a frame's recorded dirty rects touch. Coalescing the rects
// to cells means several same-frame events on one cell collapse into a single tile
// invalidation (and one re-bake) instead of one per event.
export function coalesceDirtyCells(rects: readonly Aabb[], cell: number): Set<CellKey> {
  const out = new Set<CellKey>();
  for (const r of rects) {
    for (const key of cellKeysForRect(r, cell)) out.add(key);
  }
  return out;
}

export type ResidencyAction = "hydrate" | "dehydrate" | "none";

// Residency decision for one group near the viewport: outside the hydrate ring it
// is left as is; inside, a covered-cold cluster (drawn by baked tiles with no recent
// change) is freed, and any other is hydrated.
export function residencyDecision(inHydrateRing: boolean, coveredCold: boolean): ResidencyAction {
  if (!inHydrateRing) return "none";
  return coveredCold ? "dehydrate" : "hydrate";
}
