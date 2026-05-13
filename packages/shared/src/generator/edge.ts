/**
 * Piece edge parameters and per-piece geometry.
 *
 * Edge traversal convention: every edge is parameterized from start to end in
 * the same direction for both pieces that share it, so neighbors agree on the
 * geometry without mirroring continuous params. Only `sign` flips:
 *
 *   top    edge: start = top-left,    end = top-right
 *   bottom edge: start = bottom-left, end = bottom-right
 *   left   edge: start = top-left,    end = bottom-left
 *   right  edge: start = top-right,   end = bottom-right
 *
 * `sign = +1` means the bump points outward from this piece. Two neighbors
 * sharing an edge therefore carry opposite signs.
 *
 * Continuous params, each in a fixed range chosen to keep silhouettes
 * plausible and jigsaw-shaped without self-intersection:
 *   center        x of tab center, fraction of edge length
 *   neck          half-width of the neck pinch (where the tab joins the body)
 *   depth         outward depth of the head (tab apex)
 *   shoulder      small undercut at the neck (signed: negative dips into body)
 *   tension       tangent length controlling the rise from baseline to neck
 *   tilt          left/right asymmetry of the head apex
 *   shoulderRun   length of the flat baseline at each end before the tab
 *   headRoundness tangent factor at the head apex; larger = rounder bulb
 */

export type FlatEdge = { type: "flat" };

export type CurvedEdge = {
  type: "curved";
  sign: 1 | -1;
  center: number;
  neck: number;
  depth: number;
  shoulder: number;
  tension: number;
  tilt: number;
  shoulderRun: number;
  headRoundness: number;
};

export type Edge = FlatEdge | CurvedEdge;

export type PieceGeometry = {
  id: number;
  row: number;
  col: number;
  canonicalOffset: { x: number; y: number };
  edges: { top: Edge; right: Edge; bottom: Edge; left: Edge };
};

export type PuzzleGeometry = {
  rows: number;
  cols: number;
  pieceSize: number;
  snapTolerance: number;
  pieces: PieceGeometry[];
};
