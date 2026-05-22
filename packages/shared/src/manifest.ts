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
  // Center-cropped puzzle reference image (the picture the assembled puzzle
  // reproduces). `file` is relative to the manifest; `width` and `height` are
  // the cropped dimensions, `cols * pieceSize` by `rows * pieceSize`, so the
  // image maps 1:1 onto the puzzle world rect.
  source: {
    file: string;
    width: number;
    height: number;
  };
  pieces: {
    id: number;
    file: string;
  }[];
};
