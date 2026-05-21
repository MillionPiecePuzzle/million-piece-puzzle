// Frustum culling math, kept free of Pixi and the DOM so the cull decision can
// be unit tested in isolation. The renderer side (toggling Container.culled)
// lives in puzzleStage.

// Axis-aligned bounding box in a group's local coordinate space.
export type Aabb = { minX: number; minY: number; maxX: number; maxY: number };

// Visible world rectangle: top-left world corner plus size.
export type Viewport = { worldX: number; worldY: number; worldW: number; worldH: number };

// Local AABB of a single piece. The piece container sits at its canonical
// offset; its visual (the sprite plus the tab bulges of the silhouette)
// extends one margin past the piece cell on every side.
export function pieceLocalBounds(
  offsetX: number,
  offsetY: number,
  pieceSize: number,
  margin: number,
): Aabb {
  return {
    minX: offsetX - margin,
    minY: offsetY - margin,
    maxX: offsetX + pieceSize + margin,
    maxY: offsetY + pieceSize + margin,
  };
}

// Smallest AABB enclosing every input box. Returns a zero-area box at the
// origin when given none.
export function unionBounds(boxes: readonly Aabb[]): Aabb {
  if (boxes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

// Whether a local AABB, once translated by (offsetX, offsetY) into world space,
// overlaps the viewport. Edge contact counts as visible.
export function boundsVisible(
  box: Aabb,
  offsetX: number,
  offsetY: number,
  view: Viewport,
): boolean {
  return (
    box.maxX + offsetX >= view.worldX &&
    box.minX + offsetX <= view.worldX + view.worldW &&
    box.maxY + offsetY >= view.worldY &&
    box.minY + offsetY <= view.worldY + view.worldH
  );
}
