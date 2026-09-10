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

// The screen room the cursor has on each side of it, in pixels.
export type FanRoom = { left: number; right: number; up: number; down: number };

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

// Which way the fan grows out of the cursor, one answer per axis: into the room
// ahead of it, since a hand the player cannot see is a hand they cannot work
// with. `reachX` and `reachY` are how far it stands out from the cursor on each
// axis, in screen pixels, the gap it is held off the cursor by included.
export function fanDirection(reachX: number, reachY: number, room: FanRoom): FanDirection {
  return {
    x: fanAxis(room.right, room.left, reachX),
    y: fanAxis(room.up, room.down, reachY),
  };
}

// Which way the fan grows along one axis, given the room ahead of it, the room
// behind it, and how far it reaches. It grows ahead while it fits there, turns
// back when it does not, and when a full hand fits on neither side (it is simply
// bigger than the viewport at this zoom) takes the roomier of the two, where the
// most of it shows.
function fanAxis(ahead: number, behind: number, reach: number): 1 | -1 {
  if (reach <= ahead) return 1;
  if (reach <= behind) return -1;
  return ahead >= behind ? 1 : -1;
}

// How far the whole hand slides, in screen pixels, to sit inside the view once it
// has picked its side: a hand that fits on screen is shown whole even where the
// cursor stands too close to an edge for it, since what the player has to see is
// what they are holding. An axis the fan is longer than the view on is left
// alone, where sliding would only change which part is cropped.
export function fanShift(
  cursor: { x: number; y: number },
  reach: { x: number; y: number },
  towards: FanDirection,
  view: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: axisShift(towards.x > 0 ? cursor.x : cursor.x - reach.x, reach.x, view.width),
    y: axisShift(towards.y > 0 ? cursor.y - reach.y : cursor.y, reach.y, view.height),
  };
}

function axisShift(start: number, length: number, view: number): number {
  if (length > view) return 0;
  if (start < 0) return -start;
  return Math.min(0, view - (start + length));
}
