// The single world-space grid pitch. One cell is, simultaneously: a zoom-out LOD
// bake tile, a broadcast scoping cell, the region a non-merging drop's piece cap
// counts over, and a region_state coverage cell. Fixed in world pixels (not
// pieces-relative) so the LOD texture density and VRAM budget stay predictable
// regardless of pieceSize, and so the cap protects exactly one LOD tile: the
// region the client sees is the region the server measures, with no grid mismatch
// between what the overlay draws and what the cap rejects.
export const WORLD_TILE_SIZE = 2048;

// The server-composited locked-tile pyramid (see ROADMAP Phase 5 Stages 3-5)
// builds levels 0 through this constant: level 3 already covers only 1/25 of
// the board, so no level is ever small enough to need a broadcast tier
// different from level 0's own viewport scoping. Shared so the server (which
// builds the pyramid) and the frontend (which picks a level by zoom) never
// drift apart on how many levels actually exist.
export const MAX_CELL_COMPOSITE_LEVEL = 3;
