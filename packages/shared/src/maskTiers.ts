// Downscale factors CellCompositor bakes a cell's mask/seam at (see
// DECISIONS: DZI reveal mask/seam LOD tiers), one native raster per factor,
// smallest (index 0) first. The client picks the coarsest tier that still
// covers the current zoom's need, so a min-zoom overview never has to decode
// a full-resolution silhouette for every resident cell. Shared so the
// server's bake and the client's URL construction can never drift apart.
export const CELL_MASK_TIER_FACTORS = [1, 4, 16] as const;
