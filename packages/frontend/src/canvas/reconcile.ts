// Pure decision helpers for puzzleStage's per-frame reconcile and its on-demand
// diagnostics, kept free of Pixi so they can be unit tested in isolation. The
// stage gathers the Pixi-coupled facts (ring membership, tile readiness,
// hydration state) and feeds them here.

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

export type ResidencyAction = "hydrate" | "retain" | "none";

// Residency decision for one group near the viewport: outside the hydrate ring it
// is left as is; inside, a covered-cold cluster (drawn by baked tiles with no recent
// change) is retained (kept resident, eligible for budget eviction later), and any
// other is hydrated.
export function residencyDecision(inHydrateRing: boolean, coveredCold: boolean): ResidencyAction {
  if (!inHydrateRing) return "none";
  return coveredCold ? "retain" : "hydrate";
}

// Whether a viewport cell's known content is not yet on screen, in the three real
// cases, off the same residency/visibility truth reconcile already computes:
//  - zoom-out (LOD active): the cell has groups but its tile has not baked. An empty
//    or unknown cell bakes blank instantly, so it never pends here.
//  - zoom-in, region not streamed: the board is known to stream in (coverageSeen)
//    and this cell has not been acked known. A global subscriber never sets
//    coverageSeen, so it falls through to the hydration case.
//  - zoom-in, textures loading: an in-ring group in the cell is still hydrating.
export function cellContentPending(f: {
  lodActive: boolean;
  hasGroups: boolean;
  tileReady: boolean;
  coverageSeen: boolean;
  known: boolean;
  hasUnhydratedInRingGroup: boolean;
}): boolean {
  if (f.lodActive) return f.hasGroups && !f.tileReady;
  if (f.coverageSeen && !f.known) return true;
  return f.hasUnhydratedInRingGroup;
}

export type TileState = "not-loaded" | "loading" | "loaded";

// Three-state classification for a whole-play-zone diagnostic view (the minimap
// detail modal), not to be confused with cellContentPending above: that one folds
// in coverageSeen so an intentionally-unscoped zoomed-out viewport never reads as
// "stuck loading". A whole-zone view has no such nuance to protect against: most
// of the board being unstreamed at any moment is the honest, by-design state of
// viewport-scoped streaming, not an error, so "not known" always just means
// "not loaded" here.
//
// A not-ready known cell reads "loading" only while activelyLoading holds, i.e.
// something is fetching or baking it right now. A cell that was visited earlier
// and has since been dehydrated by budget eviction (or dropped from the LOD bake
// set once the viewport moved on) is not currently doing anything and would not
// render instantly if jumped to, so it reads "not-loaded" too, same as a cell
// never visited at all.
export function classifyTile(f: {
  known: boolean;
  hasGroups: boolean;
  lodActive: boolean;
  tileReady: boolean;
  allHydrated: boolean;
  activelyLoading: boolean;
}): TileState {
  if (!f.known) return "not-loaded";
  if (!f.hasGroups) return "loaded";
  const ready = f.lodActive ? f.tileReady : f.allHydrated;
  if (ready) return "loaded";
  return f.activelyLoading ? "loading" : "not-loaded";
}
