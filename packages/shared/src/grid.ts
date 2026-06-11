// The single world-space grid pitch. One cell is, simultaneously: a zoom-out LOD
// bake tile, a broadcast scoping cell, the region a non-merging drop's piece cap
// counts over, and a region_state coverage cell. Fixed in world pixels (not
// pieces-relative) so the LOD texture density and VRAM budget stay predictable
// regardless of pieceSize, and so the cap protects exactly one LOD tile: the
// region the client sees is the region the server measures, with no grid mismatch
// between what the overlay draws and what the cap rejects.
export const WORLD_TILE_SIZE = 2048;
