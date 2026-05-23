/**
 * Image manifest produced by the image-pipeline slicer and consumed by the
 * frontend to load piece textures and the reference image.
 *
 * Each piece tile is a square of `tileSize = pieceSize + 2 * margin` pixels,
 * centered on the piece's grid cell. Tiles include the neighboring image area
 * where tabs may extend. The bezier silhouette mask is applied at render time
 * by the frontend, not baked into the AVIF.
 *
 * Tile world position: `(col * pieceSize - margin, row * pieceSize - margin)`.
 * Row and col are derived from `id`: `row = id / cols`, `col = id % cols`.
 *
 * Tiles are bucketed by hundreds under `pieces/<bucket>/<id>.avif`, where
 * `bucket = floor(id / 100)` zero-padded to 4 digits and `id` zero-padded to
 * the same width as the largest piece id. The exact relative path is carried
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
  seed: string;
  rows: number;
  cols: number;
  pieceSize: number;
  margin: number;
  tileSize: number;
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
