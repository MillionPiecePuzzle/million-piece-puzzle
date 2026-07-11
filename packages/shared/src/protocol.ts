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
 * native resolution). A group's transmitted position is the world position of its
 * anchor piece; member pieces are placed from their grid-unit (dx, dy) offsets,
 * which ride on construction/snap messages, not on every drag frame.
 *
 * Presence: viewport and cursor are transient awareness messages, never
 * persisted. Both change on every zoom and pan, so the client throttles them.
 * The server consumes viewport for broadcast scoping and relays cursor to
 * viewport-neighbor peers; join and leave bracket a peer's connection.
 */

import type { WirePiece } from "./piece.js";
import type { PlayZone } from "./playzone.js";
import type { MinimapGrid } from "./minimap.js";

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
  // Unix ms at which the event starts, the same value for every client so the
  // landing countdown and the /play entry gate agree. 0 means no scheduled
  // start (already running): clients skip the wait entirely.
  eventStartsAt: number;
  // The server's viewport scoping bound (config.broadcastMaxCells): a viewport
  // overlapping more than this many world-tile cells is a global subscriber that
  // receives no region_state. The client mirrors this to know whether its initial
  // loading cover should wait for region coverage. Optional in the schema; every
  // welcome the server sends includes it.
  broadcastMaxCells?: number;
};

// Recent anchoring history, sent once right after `state` on connect (and
// again after a server-driven rebuild like dev_reset). It seeds the activity
// feed so a joining client sees past placements, not only snaps that arrive
// live. Items are ordered newest first.
export type ActivityItem = {
  id: string;
  userId: string;
  // Contributor pseudo resolved from the user profile, null when the user has
  // not set one. Carried so backfilled items show names like the live feed.
  pseudo?: string | null;
  // Mirrors the live `snap` event: anchored is a "place" (locked into the puzzle),
  // not anchored is a "snap" (two loose clusters joined). droppedSize (placed
  // group) drives the place wording, mergedSize (resulting cluster) the snap
  // wording; the client picks by `anchored`. See SSnap.
  anchored: boolean;
  droppedSize: number;
  mergedSize: number;
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
// entries' pieces sum to the puzzle's piece count. userId is the persisted user
// id; pseudo is resolved from the user profile (null when unset). Entries are
// ordered highest first.
export type LeaderboardEntry = {
  userId: string;
  pseudo?: string | null;
  // ISO 3166-1 alpha-2 code, resolved from the user profile (null when unset).
  // Rendered as a flag avatar in the leaderboard.
  country?: string | null;
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
  // The pieces folded into the surviving group, each with its grid-unit offset
  // from the new group's anchor so the client reparents and places them.
  addedPieceIds: WirePiece[];
  // World position of the surviving group's anchor piece.
  worldX: number;
  worldY: number;
  anchored: boolean;
  // Activity-feed sizing, both sent raw so the client picks by `anchored`.
  // droppedSize is the group the user dragged (>= 1), shown for a place ("placed a
  // 5-piece cluster"). mergedSize is the resulting cluster (>= 2 for a snap), shown
  // for a snap ("connected a 5-piece cluster", or "two pieces together" at 2).
  // Distinct from addedPieceIds.length, which follows group-id order.
  droppedSize: number;
  mergedSize: number;
  userId: string;
  // Pseudo of the snapping user, null if unset. Carried on the live event to
  // avoid a profile lookup on the hot path; the Mongo-backed activity backfill
  // resolves the same pseudo via a join.
  pseudo: string | null;
  at: number;
  lockedCount: number;
};

export type SRollback = {
  t: "rollback";
  groupId: number;
  worldX: number;
  worldY: number;
  // Why the drop was reverted, when it was the server rejecting it rather than a
  // lost grab. "tile_full": the destination tile is at its piece cap, so the
  // client flashes that tile and toasts. Absent for a plain position correction
  // (e.g. the rollback sent to neighbours, or a lost-grab bounce).
  reason?: "tile_full";
};

// Presence, server to client. join is sent to a connecting client once per peer
// already present, and to existing peers when a new peer connects. The pseudo
// is the peer's authenticated profile pseudo, fixed for the connection. leave
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

// Construction data for one group in a region_state stream: its anchor world
// position (worldX, worldY), locked state, member count, and member pieces (each
// with its grid-unit offset from the anchor). The client upserts it: build the
// group when unknown, or reposition and additively reconcile membership/locked
// when known.
export type RegionGroup = {
  groupId: number;
  worldX: number;
  worldY: number;
  locked: boolean;
  size: number;
  pieces: WirePiece[];
};

// Viewport-scoped region state. `welcome` carries no board (protocol v3); instead
// a client's first bounded `viewport` (and every later pan that enters new
// broadcast cells) triggers this with construction data for the groups in those
// cells, so the join payload is bounded by the viewport, not the piece count. A
// default fit viewport is a global subscription and streams nothing by design;
// the minimap carries the zoomed-out overview meanwhile. The client builds an
// unknown group and, for a known one, applies the origin only when it is not the
// live authority for it (the ordering guard: holding it, a peer holding it, or an
// in-flight local drop keep their newer local position) while always reconciling
// membership and locked state.
export type SRegionState = {
  t: "region_state";
  groups: RegionGroup[];
  // World rectangle the client's entered broadcast cells cover. An entered cell
  // with no groups still acknowledges its area here (the message is sent even when
  // `groups` is empty), so the client can mark its own cells "known" and tell a
  // region that has not streamed in yet from a genuinely empty one. Absent on a
  // global subscription, which streams nothing by design.
  coverage?: { minX: number; minY: number; maxX: number; maxY: number };
};

// Downsampled board density grid for the minimap overview. Broadcast to
// contributors periodically (tied to the snapshot cadence) plus once on join, so
// a contributor renders the global overview without downloading the full board.
export type SMinimap = {
  t: "minimap";
  grid: MinimapGrid;
};

// HTTP response for GET /landing: lightweight public landing data read once on
// page load. `status` and `eventStartsAt` drive the landing phase: scheduled
// before the start, live while active, completed once the board is done. `progress`
// and `leaderboard` carry the live and recap figures, `activity` the live feed.
// `completion` is present only when completed: the final placement `at` (the recap
// date) and the first placement `startedAt`. The leaderboard and activity come from
// the in-memory board snapshot, never a full-board fetch.
export type LandingResponse = {
  eventStartsAt: number;
  interested: { count: number; me: boolean };
  status: "active" | "completed";
  progress: { locked: number; total: number };
  leaderboard: LeaderboardEntry[];
  activity: ActivityItem[];
  completion?: { at: number; startedAt: number };
};

// Admission queue (see DECISIONS: admission queue). A client requests a ticket,
// then either connects immediately with the grant or polls status until a slot
// frees. `ready` carries the one-time grant for the WS `?grant=` query; `queued`
// carries a 1-based position estimate; `disabled` means the server has no cap, so
// the client connects with no grant; `busy` means the wait list is full (retry);
// `expired` (status only) means the ticket was reaped, so re-request one.
export type QueueTicketResponse =
  | { state: "ready"; ticket: string; grant: string }
  | { state: "queued"; ticket: string; position: number }
  | { state: "disabled" }
  | { state: "busy" };

export type QueueStatusResponse =
  | { state: "ready"; ticket: string; grant: string }
  | { state: "queued"; ticket: string; position: number }
  | { state: "disabled" }
  | { state: "expired" };

export type ServerMessage =
  | SWelcome
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
  | SError
  | SRegionState
  | SMinimap;
