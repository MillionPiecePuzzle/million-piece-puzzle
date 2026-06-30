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

import type { GroupRuntime, PieceRuntime, WirePiece } from "./piece.js";
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
  // Unix ms at which the event starts and the entrance cascade triggers, the
  // same value for every client so they can fire it in sync. 0 means no
  // scheduled start (already running): clients skip the wait and the cascade.
  eventStartsAt: number;
  // The server's viewport scoping bound (config.broadcastMaxCells): a viewport
  // overlapping more than this many world-tile cells is a global subscriber that
  // receives no region_state. The contributor client mirrors this to know whether
  // its initial loading cover should wait for region coverage. Absent on the
  // spectator's synthetic welcome (it builds the whole board from the keyframe).
  broadcastMaxCells?: number;
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
// contributors periodically (tied to the keyframe cadence) plus once on join, so
// a contributor renders the global overview without downloading the full board;
// spectators read the same grid from the keyframe.
export type SMinimap = {
  t: "minimap";
  grid: MinimapGrid;
};

// Spectator stream for the read-only view, an HTTP keyframe plus a tail of
// immutable event windows (see DECISIONS: spectator keyframe + event log). The
// keyframe is the full board state at a logical timestamp; the client loads it,
// then tails event windows a few seconds behind live, interpolating group
// positions between drops and replaying snap animations in order. The per-tick
// payload becomes proportional to the events in the interval, independent of
// piece count, so it scales to 1M pieces where a full snapshot per tick does not.

// Full board state, served at GET /keyframe and regenerated only while the event
// is live. Mirrors what `welcome` + `state` + the standings carry on the
// WebSocket so the stage can build from it, plus the stream parameters the
// client needs to tail windows.
export type SpectatorKeyframe = {
  // SPECTATOR_FORMAT_VERSION at build time; client re-bases or errors on a bump.
  v: number;
  puzzleId: string;
  // ms; the state's logical timestamp, the re-base anchor (the client applies a
  // fresh keyframe exactly when its render clock reaches this, so no visual jump).
  generatedAt: number;
  // Event-log stream id at build time. The client skips events with id <= cursor
  // (already folded into this keyframe), deduping the keyframe against the tail.
  cursor: string;
  // Window width W in ms: GET /events/<t0> covers [t0, t0+W).
  windowMs: number;
  // Interpolation delay budget D in ms: the client renders this far behind live.
  delayMs: number;
  // Server is actively regenerating the keyframe (event live). Informational;
  // the client also derives the same gate from eventStartsAt + lockedCount.
  live: boolean;
  lockedCount: number;
  totalPieces: number;
  playZone: PlayZone;
  // Mirrors `welcome.eventStartsAt` so a spectator shows the same countdown a
  // contributor sees. 0 means no scheduled start.
  eventStartsAt: number;
  pieces: PieceRuntime[];
  groups: GroupRuntime[];
  // Mirror the `leaderboard` and `activity` WS messages so spectators get the
  // same standings and recent-placement feed. Ordered like their WS counterparts
  // (leaderboard highest first, activity newest first).
  leaderboard: LeaderboardEntry[];
  activity: ActivityItem[];
  // Downsampled board density grid the spectator minimap renders from, the same
  // grid contributors receive over the WS `minimap` message.
  minimapGrid: MinimapGrid;
};

// A non-merging drop: a cluster moved to a resting position. The client
// interpolates the group's origin from its current position to (worldX, worldY)
// between this event's `at` and the next drop/snap for the group.
export type SpectatorDropEvent = {
  k: "drop";
  // Redis stream id (`<ms>-<n>`): monotonic, unique, the dedup and ordering key.
  seq: string;
  at: number;
  groupId: number;
  worldX: number;
  worldY: number;
};

// A merge (cluster lock). Mirrors `SSnap` so the client reuses `applySnap` and
// the existing lockedCount + activity-ticker handling unchanged.
export type SpectatorSnapEvent = {
  k: "snap";
  seq: string;
  at: number;
  mergeId: string;
  newGroupId: number;
  addedPieceIds: WirePiece[];
  worldX: number;
  worldY: number;
  anchored: boolean;
  droppedSize: number;
  mergedSize: number;
  userId: string;
  pseudo: string | null;
  lockedCount: number;
};

export type SpectatorEvent = SpectatorDropEvent | SpectatorSnapEvent;

// Order two spectator event `seq` values (Redis stream ids, "<ms>-<n>"). Stream
// ids are not lexicographically ordered ("100-0" precedes "99-0" as strings), so
// both parts are parsed: the ms component first, then the per-ms counter. Used
// client-side to dedup events against a keyframe cursor and to order the pending
// buffer. Returns a negative number, zero, or a positive number like a comparator.
export function compareSpectatorSeq(a: string, b: string): number {
  const da = a.indexOf("-");
  const ams = da < 0 ? Number(a) : Number(a.slice(0, da));
  const aseq = da < 0 ? 0 : Number(a.slice(da + 1));
  const db = b.indexOf("-");
  const bms = db < 0 ? Number(b) : Number(b.slice(0, db));
  const bseq = db < 0 ? 0 : Number(b.slice(db + 1));
  if (ams !== bms) return ams - bms;
  return aseq - bseq;
}

// One sealed event window, served at GET /events/<t0> with `t0 = floor(t/W)*W`.
// Immutable once `now >= t0 + W`, so the CDN can cache it for a year. Events are
// ordered by `seq`.
export type SpectatorEventWindow = {
  v: number;
  t0: number;
  windowMs: number;
  events: SpectatorEvent[];
};

// HTTP response for GET /landing: lightweight public landing data read once on
// page load. `status` and `eventStartsAt` drive the landing phase: scheduled
// before the start, live while active, completed once the board is done. `progress`
// and `leaderboard` carry the live and recap figures, `activity` the live feed.
// `completion` is present only when completed: the final placement `at` (the recap
// date) and the first placement `startedAt`. The leaderboard and activity come from
// the in-memory keyframe snapshot, never a full-board fetch (see SpectatorKeyframe).
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
  | SError
  | SRegionState
  | SMinimap;
