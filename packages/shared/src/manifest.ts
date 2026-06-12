/**
 * Image manifest produced by the image-pipeline slicer and consumed by the
 * frontend to load piece textures and the reference image.
 *
 * Each piece tile is a square of `tileSize = pieceSize + 2 * margin` pixels,
 * centered on the piece's grid cell. Tiles include the neighboring image area
 * where tabs may extend. The bezier silhouette and its border are baked into the
 * AVIF alpha by the slicer (`premasked` / `borderBaked`), so the frontend shows
 * the tile as-is and needs no piece geometry to render. The generation seed is
 * NOT in the manifest: the manifest is publicly served, so shipping the seed would
 * let a client regenerate every silhouette and reconstruct adjacency. Geometry
 * lives only in the slicer (offline) and the server (server-only seed).
 *
 * Ids are seed-permuted (`id = P(gridId)`, see permutation.ts), so neither the
 * manifest nor the tile path reveals a piece's solved grid cell. Tiles are
 * bucketed by hundreds under `pieces/<bucket>/<id>.avif`, where
 * `bucket = floor(id / 100)` zero-padded to 4 digits and `id` (the permuted id)
 * zero-padded to the width of the largest id. The exact relative path is carried
 * by each entry's `file` field.
 *
 * The reference image is published as a Deep Zoom pyramid: `source.dzi` is the
 * XML descriptor, sibling folder `source_files/<level>/<x>_<y>.<ext>` holds the
 * tiles. `width` and `height` are the cropped dimensions
 * (`cols * pieceSize` by `rows * pieceSize`), so the pyramid maps 1:1 onto the
 * puzzle world rect.
 */

export type ImageManifest = {
  puzzleId: string;
  name: string;
  rows: number;
  cols: number;
  pieceSize: number;
  margin: number;
  tileSize: number;
  // When true, each piece AVIF already has the bezier silhouette cut into its
  // alpha (server-side bake), so consumers render the tile as-is and skip any
  // render-time silhouette mask.
  premasked: boolean;
  // When true, the silhouette outline (PIECE_BORDER_* style) is stroked into the
  // tile by the slicer, so consumers skip the render-time per-piece stroke.
  borderBaked: boolean;
  source: {
    dzi: string;
    width: number;
    height: number;
  };
  pieces: {
    id: number;
    file: string;
  }[];
};
