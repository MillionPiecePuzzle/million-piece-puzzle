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
 *
 * Presence: viewport and cursor are transient awareness messages, never
 * persisted. Both change on every zoom and pan, so the client throttles them.
 * The server consumes viewport for broadcast scoping and relays cursor to
 * viewport-neighbor peers; join and leave bracket a peer's connection.
 */

import type { GroupRuntime, PieceRuntime } from "./piece.js";
import type { PlayZone } from "./playzone.js";

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

// Presence, client to server. The client reports its viewport and cursor so the
// server can scope broadcasts and relay cursors to viewport-neighbor peers. Both
// change on every zoom and pan: the client throttles sends. Transient, never
// persisted.

export type CViewport = {
  t: "viewport";
  worldX: number;
  worldY: number;
  worldW: number;
  worldH: number;
};

export type CCursor = {
  t: "cursor";
  worldX: number;
  worldY: number;
};

// Anonymous pseudo chosen by the client, attached to the connection. Sent on
// first contribution and on every change. Not persisted: it lives on the WS
// connection only, so there is no uniqueness check.
export type CSetPseudo = {
  t: "setPseudo";
  pseudo: string;
};

// Dev-only messages, gated server-side by MPP_DEV_ENABLED.
// dev_reset: wipe and re-init the current puzzle (stays on the same puzzle).
// dev_complete: force-complete the current puzzle (locked count jumps to total,
// status flips to completed). The puzzle stays completed until a dev_reset.
// dev_place: anchor one random unlocked cluster to the frame origin, as if a
// human had dropped it in its solved spot (emits a normal anchoring snap).
export type CDevReset = { t: "dev_reset" };
export type CDevComplete = { t: "dev_complete" };
export type CDevPlace = { t: "dev_place" };

export type ClientMessage =
  | CHello
  | CGrab
  | CDrag
  | CDrop
  | CViewport
  | CCursor
  | CSetPseudo
  | CDevReset
  | CDevComplete
  | CDevPlace;

// Server -> Client

// The server holds a single puzzle for the connection's lifetime. Welcome
// carries its `puzzleId`; the client fetches the matching manifest at
// `/puzzles/<puzzleId>/manifest.json`. A second welcome on the same
// connection signals a reset (dev_reset) and the client must rebuild.
export type SWelcome = {
  t: "welcome";
  userId: string;
  protocolVersion: number;
  puzzleId: string;
  lockedCount: number;
  // World-space bounds of the puzzle, computed once by the server and identical
  // for every client regardless of join time: camera limits, the held-piece
  // clamp, and the minimap extent all derive from it.
  playZone: PlayZone;
};

export type SState = {
  t: "state";
  pieces: PieceRuntime[];
  groups: GroupRuntime[];
};

// Recent anchoring history, sent once right after `state` on connect (and
// again after a server-driven rebuild like dev_reset). It seeds the activity
// feed so a joining client sees past placements, not only snaps that arrive
// live. Items are ordered newest first.
export type ActivityItem = {
  id: string;
  userId: string;
  lockedDelta: number;
  at: number;
};

export type SActivity = {
  t: "activity";
  items: ActivityItem[];
};

// Per-user contribution standings for the active puzzle, derived on demand from
// the ClusterMerge log. Broadcast after every anchoring snap and sent to each
// client on join, so the in-game leaderboard stays live. Each piece is worth
// one point, credited to the user of the first merge that dragged it; every
// piece is dragged at least once on its way to its solved position, so the
// entries' pieces sum to the puzzle's piece count. userId is the ephemeral
// connection id: pseudos are not persisted, so no name is carried. Entries are
// ordered highest first.
export type LeaderboardEntry = {
  userId: string;
  pieces: number;
};

export type SLeaderboard = {
  t: "leaderboard";
  entries: LeaderboardEntry[];
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
  // Pseudo of the snapping client at snap time, null if they never set one.
  // Carried per event because pseudos are not persisted: the activity backfill
  // rebuilt from Mongo cannot recover them.
  pseudo: string | null;
  at: number;
  lockedCount: number;
};

export type SRollback = {
  t: "rollback";
  groupId: number;
  worldX: number;
  worldY: number;
};

// Presence, server to client. join is sent to a connecting client once per peer
// already present, to existing peers when a new peer connects, and again to
// peers when a peer changes its pseudo (so a stale pseudo tag refreshes). leave
// is sent when a peer disconnects. cursor relays a peer's pointer to its
// viewport-neighbor peers. There is no server viewport relay: viewport is a
// server-side broadcast-scoping input only.

export type SJoin = {
  t: "join";
  userId: string;
  pseudo: string | null;
};

export type SLeave = {
  t: "leave";
  userId: string;
};

export type SCursor = {
  t: "cursor";
  userId: string;
  worldX: number;
  worldY: number;
};

export type SError = {
  t: "error";
  code: "bad_message" | "unknown_group" | "protocol_mismatch" | "not_held" | "dev_disabled";
  message: string;
};

// HTTP snapshot for spectator mode. Served by the server at GET /snapshot and
// cached at the CDN edge with a short TTL. Mirrors what `welcome` + `state`
// carry on the WebSocket so a consumer can render the canvas without opening a
// WebSocket. Cursors, drags, and presence are deliberately absent: spectators
// get a delayed, position-only view (see ROADMAP backlog for a future
// keyframe + event-log stream that brings interpolation back).
export type Snapshot = {
  puzzleId: string;
  generatedAt: number;
  lockedCount: number;
  totalPieces: number;
  playZone: PlayZone;
  pieces: PieceRuntime[];
  groups: GroupRuntime[];
};

export type ServerMessage =
  | SWelcome
  | SState
  | SActivity
  | SLeaderboard
  | SGrabOk
  | SGrabDenied
  | SDrag
  | SDrop
  | SSnap
  | SRollback
  | SJoin
  | SLeave
  | SCursor
  | SError;
