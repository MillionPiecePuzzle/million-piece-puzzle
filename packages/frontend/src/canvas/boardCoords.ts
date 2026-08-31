// The player-facing coordinate frame, kept free of Pixi and the DOM so the
// conversion can be unit tested in isolation. World space has its origin at the
// frame's top-left corner and measures in source-image pixels, which puts the
// middle of the 1M board at (60000, 60000) and costs six digits an axis: no
// number a player can carry in their head or read out to someone. Board space is
// the same axes in pieces, centered on the frame, so the 1M board reads (0, 0) at
// its middle and (-500, -500) to (500, 500) at its corners. Y runs down like the
// world, so the conversion is a translation and a scale with no mirror.

// The three manifest fields the frame is built from, so an ImageManifest passes
// as-is.
export type BoardFrame = { cols: number; rows: number; pieceSize: number };

export type BoardPoint = { x: number; y: number };

export function worldToBoard(worldX: number, worldY: number, frame: BoardFrame): BoardPoint {
  return {
    x: (worldX - (frame.cols * frame.pieceSize) / 2) / frame.pieceSize,
    y: (worldY - (frame.rows * frame.pieceSize) / 2) / frame.pieceSize,
  };
}

export function boardToWorld(boardX: number, boardY: number, frame: BoardFrame): BoardPoint {
  return {
    x: boardX * frame.pieceSize + (frame.cols * frame.pieceSize) / 2,
    y: boardY * frame.pieceSize + (frame.rows * frame.pieceSize) / 2,
  };
}

// The readout's own text: whole pieces, since a fraction of a piece is below what
// a player can point at and the pillar it sits in has one line to spend.
export function formatBoardPoint(point: BoardPoint): string {
  return `(${Math.round(point.x)}, ${Math.round(point.y)})`;
}
