// The layout a carried hand floats in beside the cursor. Every cluster sits in
// its own slot of a grid whose cell is the largest cluster in the hand, so no two
// overlap however different their shapes, and the grid is as square as the count
// allows rather than one long row, which at ten clusters would run off the side of
// the screen. Slots fill left to right then upward from the corner nearest the
// pointer, so the hand grows away from the board the player is reading under it.
// Pure, so the geometry is unit-tested without mounting Pixi.

export type FanCell = { width: number; height: number };

export type FanSlot = { dx: number; dy: number };

// Which way the fan grows out of the cursor: +1 right / up, -1 left / down.
export type FanDirection = { x: 1 | -1; y: 1 | -1 };

export function fanColumns(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

// Offset of one slot from the fan's own corner: dx to the right, dy upward, both
// in world units, `gap` being the clear space kept between two slots.
export function fanSlot(index: number, columns: number, cell: FanCell, gap: number): FanSlot {
  return {
    dx: (index % columns) * (cell.width + gap),
    dy: Math.floor(index / columns) * (cell.height + gap),
  };
}

// Which way the fan grows along one axis, given the screen room on the side it
// prefers, the room on the other, and how far it reaches. It keeps its preferred
// side while the fan fits there, takes the other when it does not, and when a
// full hand fits on neither (it is simply bigger than the viewport at this zoom)
// takes the roomier of the two, where the most of it shows.
export function fanAxis(preferred: number, other: number, reach: number): 1 | -1 {
  if (reach <= preferred) return 1;
  if (reach <= other) return -1;
  return preferred >= other ? 1 : -1;
}
