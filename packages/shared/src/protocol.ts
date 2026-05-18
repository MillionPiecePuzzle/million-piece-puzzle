/**
 * WebSocket protocol between frontend and server.
 *
 * Messages are JSON discriminated unions tagged by `t`. Short field names keep
 * the wire compact for high-frequency drag broadcasts.
 *
 * Concurrency: the server processes messages sequentially and is authoritative.
 * Clients may optimistically apply a grab for 50 to 100 ms while awaiting the
 * server's grab_ok or grab_denied. A losing grab triggers a rollback.
 *
 * Coordinates: worldX and worldY are in puzzle world space (pixels at piece
 * native resolution). Group position is the only thing transmitted on drag;
 * individual piece positions are derived from canonical offsets.
 */

import type { GroupRuntime, PieceRuntime } from "./piece.js";

// Client -> Server

export type CHello = {
  t: "hello";
  protocolVersion: number;
  puzzleId: string;
};

export type CGrab = {
  t: "grab";
  groupId: number;
};

export type CDrag = {
  t: "drag";
  groupId: number;
  worldX: number;
  worldY: number;
};

export type CDrop = {
  t: "drop";
  groupId: number;
  worldX: number;
  worldY: number;
};

// Dev-only messages, gated server-side by MPP_DEV_ENABLED.
// dev_reset: wipe and re-init the current puzzle (stays on the same puzzle).
// dev_complete: force-complete the current puzzle so the server cycles to the next.
export type CDevReset = { t: "dev_reset" };
export type CDevComplete = { t: "dev_complete" };

export type ClientMessage = CHello | CGrab | CDrag | CDrop | CDevReset | CDevComplete;

// Server -> Client

// Server picks the active puzzle (sequential rotation). Client fetches the
// matching manifest at `/puzzles/<puzzleId>/manifest.json` after welcome.
// A second welcome on the same connection signals a puzzle cycle and the
// client must reset and reload.
export type SWelcome = {
  t: "welcome";
  userId: string;
  protocolVersion: number;
  puzzleId: string;
  lockedCount: number;
};

export type SState = {
  t: "state";
  pieces: PieceRuntime[];
  groups: GroupRuntime[];
};

export type SGrabOk = {
  t: "grab_ok";
  groupId: number;
  userId: string;
};

export type SGrabDenied = {
  t: "grab_denied";
  groupId: number;
  heldBy: string;
};

export type SDrag = {
  t: "drag";
  groupId: number;
  worldX: number;
  worldY: number;
  userId: string;
};

export type SDrop = {
  t: "drop";
  groupId: number;
  worldX: number;
  worldY: number;
  userId: string;
};

export type SSnap = {
  t: "snap";
  mergeId: string;
  newGroupId: number;
  addedPieceIds: number[];
  worldX: number;
  worldY: number;
  anchored: boolean;
  userId: string;
  at: number;
  lockedCount: number;
};

export type SRollback = {
  t: "rollback";
  groupId: number;
  worldX: number;
  worldY: number;
};

export type SError = {
  t: "error";
  code: "bad_message" | "unknown_group" | "protocol_mismatch" | "not_held" | "dev_disabled";
  message: string;
};

export type ServerMessage =
  | SWelcome
  | SState
  | SGrabOk
  | SGrabDenied
  | SDrag
  | SDrop
  | SSnap
  | SRollback
  | SError;
