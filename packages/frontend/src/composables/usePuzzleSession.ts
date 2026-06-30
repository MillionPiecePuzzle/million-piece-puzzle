import { computed, ref, shallowRef } from "vue";
import type {
  ActivityItem,
  GroupRuntime,
  ImageManifest,
  LeaderboardEntry,
  PieceRuntime,
  QueueStatusResponse,
  QueueTicketResponse,
  SActivity,
  SError,
  SSnap,
  SState,
  SWelcome,
  ServerMessage,
} from "@mpp/shared";
import { PuzzleWsClient } from "../canvas/wsClient";
import { manifestUrlFor } from "../data/manifestUrl";
import { queueStatusUrl, queueTicketUrl } from "../data/queueUrl";
import { useMode } from "./useMode";

const DEFAULT_WS_URL = "ws://localhost:8080/";
const ACTIVITY_LIMIT = 6;
// Admission-queue poll cadence while waiting for a slot, and the slower retry when
// the wait list itself is full (no ticket yet). Both stay under the server's
// per-IP queue-rate window.
const QUEUE_POLL_MS = 2_500;
const QUEUE_BUSY_RETRY_MS = 5_000;

export type Transport = "none" | "ws";

export type PuzzleSessionState =
  | { kind: "idle" }
  | { kind: "connecting" }
  // Waiting in the admission queue past the server cap. `position` is the 1-based
  // place in line, or 0 when the wait list is full and the client is retrying for
  // a ticket (no position to show yet).
  | { kind: "queued"; position: number }
  | { kind: "loading-manifest"; puzzleId: string }
  | { kind: "syncing"; manifest: ImageManifest; welcome: SWelcome }
  | {
      kind: "ready";
      manifest: ImageManifest;
      welcome: SWelcome;
      pieces: PieceRuntime[];
      groups: GroupRuntime[];
      epoch: number;
    }
  | { kind: "error"; message: string };

export type MessageHandler = (msg: ServerMessage) => void;

export type ActivityEntry = {
  id: string;
  actor: string;
  // "place": dragged group locked into the puzzle (anchored). "snap": two loose
  // clusters joined without locking.
  kind: "snap" | "place";
  // Piece count of the dragged group: 1 renders "a piece", more renders a cluster.
  count: number;
  at: number;
};

const state = shallowRef<PuzzleSessionState>({ kind: "idle" });
const userId = ref<string | null>(null);
const puzzleName = ref<string | null>(null);
// Unix ms the event started at, mirrored from welcome. 0 means no scheduled start.
// Drives the top bar's live play-time counter.
const eventStartsAt = ref(0);
const totalPieces = ref(0);
const lockedCount = ref(0);
const activity = ref<ActivityEntry[]>([]);
const leaderboard = ref<LeaderboardEntry[]>([]);
const transport = ref<Transport>("none");
// The puzzle is finished once every piece is locked. Derived so the shell can
// gate the contributor entry points (Contribute card, auth modal) on it.
const completed = computed(() => totalPieces.value > 0 && lockedCount.value >= totalPieces.value);

let client: PuzzleWsClient | null = null;
let welcome: SWelcome | null = null;
let manifest: ImageManifest | null = null;
let pendingState: SState | null = null;
let started = false;
// Admission-queue gate: an in-flight ticket/status fetch, the poll-delay timer,
// and the delay's resolver, all torn down by close() so leaving the queue cancels
// promptly (the resolver unblocks a pending delay so the gate loop exits at once).
let queueAbort: AbortController | null = null;
let queueTimer: ReturnType<typeof setTimeout> | null = null;
let queueDelayResolve: (() => void) | null = null;
let buildEpoch = 0;
const handlers = new Set<MessageHandler>();
// Dev messages clicked before the WebSocket is connected. They are queued here and
// flushed once the connection delivers the welcome.
type DevTag = "dev_reset" | "dev_complete" | "dev_place";
let pendingDev: DevTag[] = [];

function snapActor(msg: SSnap): string {
  if (msg.userId === userId.value) return "you";
  return msg.pseudo ?? msg.userId;
}

function recordSnap(msg: SSnap): void {
  const prev = lockedCount.value;
  // lockedCount is the server's cumulative total and only ever grows. Concurrent
  // anchoring merges on disjoint groups broadcast their snaps in an order not
  // tied to the Redis INCRBY order, so a lower count can arrive after a higher
  // one; clamp to monotonic so the count never regresses (which at completion
  // would leave the session reading not-yet-complete).
  lockedCount.value = Math.max(prev, msg.lockedCount);
  const entry: ActivityEntry = {
    id: msg.mergeId,
    actor: snapActor(msg),
    kind: msg.anchored ? "place" : "snap",
    // A place reports the placed group; a snap reports the resulting cluster.
    count: msg.anchored ? msg.droppedSize : msg.mergedSize,
    at: msg.at,
  };
  activity.value = [entry, ...activity.value].slice(0, ACTIVITY_LIMIT);
}

function activityActor(item: ActivityItem): string {
  if (item.userId === userId.value) return "you";
  return item.pseudo ?? item.userId;
}

function applyActivity(msg: SActivity): void {
  activity.value = msg.items
    .map((item) => ({
      id: item.id,
      actor: activityActor(item),
      kind: item.anchored ? ("place" as const) : ("snap" as const),
      count: item.anchored ? item.droppedSize : item.mergedSize,
      at: item.at,
    }))
    .slice(0, ACTIVITY_LIMIT);
}

function applyState(msg: SState): void {
  if (!welcome || !manifest) return;
  buildEpoch += 1;
  state.value = {
    kind: "ready",
    manifest,
    welcome,
    pieces: msg.pieces,
    groups: msg.groups,
    epoch: buildEpoch,
  };
}

function handleServerError(msg: SError): void {
  if (msg.code === "protocol_mismatch") {
    state.value = { kind: "error", message: `${msg.code}: ${msg.message}` };
    return;
  }
  console.warn(`puzzle session: transient server error ${msg.code}: ${msg.message}`);
}

async function loadManifestFor(puzzleId: string): Promise<void> {
  const url = manifestUrlFor(puzzleId);
  state.value = { kind: "loading-manifest", puzzleId };
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    manifest = (await res.json()) as ImageManifest;
  } catch (e) {
    state.value = {
      kind: "error",
      message: `failed to load manifest from ${url}: ${(e as Error).message}`,
    };
    return;
  }
  puzzleName.value = manifest.name;
  totalPieces.value = manifest.pieces.length;
  if (welcome) {
    state.value = { kind: "syncing", manifest, welcome };
  }
  if (pendingState) {
    const buffered = pendingState;
    pendingState = null;
    applyState(buffered);
  }
}

async function handleWelcome(msg: SWelcome): Promise<void> {
  welcome = msg;
  userId.value = msg.userId;
  eventStartsAt.value = msg.eventStartsAt;
  lockedCount.value = msg.lockedCount;
  activity.value = [];
  leaderboard.value = [];
  pendingState = null;
  flushPendingDev();
  const needsLoad = !manifest || manifest.puzzleId !== msg.puzzleId;
  if (needsLoad) {
    manifest = null;
    await loadManifestFor(msg.puzzleId);
  } else if (manifest) {
    state.value = { kind: "syncing", manifest, welcome };
  }
  // Welcome carries no board (protocol v6): build an empty board now and let groups
  // stream in per viewport via region_state.
  if (manifest && welcome) {
    applyState({ t: "state", pieces: [], groups: [] });
  }
}

// The connection is open by the time welcome arrives, so any dev message queued
// before the connection completed can be sent now.
function flushPendingDev(): void {
  if (pendingDev.length === 0 || !client) return;
  for (const t of pendingDev) client.send({ t });
  pendingDev = [];
}

async function startContributor(): Promise<void> {
  if (started) return;
  started = true;
  transport.value = "ws";
  state.value = { kind: "connecting" };
  welcome = null;
  manifest = null;
  let grant: string | null;
  try {
    grant = await acquireAdmission();
  } catch (e) {
    if (started) {
      state.value = { kind: "error", message: `failed to join the queue: ${(e as Error).message}` };
    }
    started = false;
    return;
  }
  // close() during the wait flips started false; bail without connecting.
  if (!started) return;
  connectWs(grant);
}

// Admission gate: request a ticket, then connect immediately when granted or poll
// status while queued until a slot frees. Returns the grant token to connect with,
// or null to connect ungated (the server has no cap). Throws only when the initial
// join fails; once queued, a transient poll failure retries rather than dropping
// the player out of the line.
async function acquireAdmission(): Promise<string | null> {
  let ticket: string | null = null;
  let queuedOnce = false;
  while (started) {
    let resp: QueueTicketResponse | QueueStatusResponse;
    try {
      resp = ticket === null ? await postQueueTicket() : await getQueueStatus(ticket);
    } catch (e) {
      if (!started) return null;
      if (!queuedOnce) throw e;
      ticket = null;
      await queueDelay(QUEUE_POLL_MS);
      continue;
    }
    if (!started) return null;
    if (resp.state === "disabled") return null;
    if (resp.state === "ready") return resp.grant;
    if (resp.state === "queued") {
      queuedOnce = true;
      ticket = resp.ticket;
      state.value = { kind: "queued", position: resp.position };
      await queueDelay(QUEUE_POLL_MS);
      continue;
    }
    if (resp.state === "busy") {
      // Wait list full: no ticket, retry from scratch after a longer beat.
      queuedOnce = true;
      ticket = null;
      state.value = { kind: "queued", position: 0 };
      await queueDelay(QUEUE_BUSY_RETRY_MS);
      continue;
    }
    // expired: the ticket was reaped, re-request one.
    ticket = null;
  }
  return null;
}

async function postQueueTicket(): Promise<QueueTicketResponse> {
  queueAbort = new AbortController();
  const res = await fetch(queueTicketUrl(), { method: "POST", signal: queueAbort.signal });
  if (!res.ok) throw new Error(`queue ticket ${res.status}`);
  return (await res.json()) as QueueTicketResponse;
}

async function getQueueStatus(ticket: string): Promise<QueueStatusResponse> {
  queueAbort = new AbortController();
  const res = await fetch(queueStatusUrl(ticket), { signal: queueAbort.signal });
  if (!res.ok) throw new Error(`queue status ${res.status}`);
  return (await res.json()) as QueueStatusResponse;
}

function queueDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    queueDelayResolve = resolve;
    queueTimer = setTimeout(() => {
      queueTimer = null;
      queueDelayResolve = null;
      resolve();
    }, ms);
  });
}

// Tear down the admission gate: abort an in-flight fetch and resolve any pending
// poll delay so the acquireAdmission loop wakes and exits (started is already
// false by the time this runs from close()).
function cancelQueueGate(): void {
  queueAbort?.abort();
  queueAbort = null;
  if (queueTimer !== null) {
    clearTimeout(queueTimer);
    queueTimer = null;
  }
  if (queueDelayResolve) {
    const resolve = queueDelayResolve;
    queueDelayResolve = null;
    resolve();
  }
}

// Open the contributor WebSocket, carrying the admission grant as `?grant=` when
// the queue is enabled. Wires the message and close handlers the session needs.
function connectWs(grant: string | null): void {
  state.value = { kind: "connecting" };
  const wsUrl = import.meta.env.VITE_WS_URL || DEFAULT_WS_URL;
  client = new PuzzleWsClient(grant ? appendGrant(wsUrl, grant) : wsUrl);

  client.on((msg: ServerMessage) => {
    if (msg.t === "welcome") {
      void handleWelcome(msg);
    } else if (msg.t === "snap") {
      recordSnap(msg);
    } else if (msg.t === "activity") {
      applyActivity(msg);
    } else if (msg.t === "leaderboard") {
      leaderboard.value = msg.entries;
    } else if (msg.t === "error") {
      handleServerError(msg);
    }
    for (const h of handlers) h(msg);
  });

  client.onClose(({ intentional }) => {
    if (intentional) return;
    welcome = null;
    manifest = null;
    started = false;
    if (state.value.kind === "error") return;
    state.value = {
      kind: "error",
      message: `connection lost to ${wsUrl}`,
    };
  });

  client.connect();
}

function appendGrant(wsUrl: string, grant: string): string {
  try {
    const u = new URL(wsUrl);
    u.searchParams.set("grant", grant);
    return u.toString();
  } catch {
    const sep = wsUrl.includes("?") ? "&" : "?";
    return `${wsUrl}${sep}grant=${encodeURIComponent(grant)}`;
  }
}

function close(): void {
  client?.close();
  client = null;
  cancelQueueGate();
  welcome = null;
  manifest = null;
  pendingState = null;
  started = false;
  transport.value = "none";
  state.value = { kind: "idle" };
  userId.value = null;
  eventStartsAt.value = 0;
  lockedCount.value = 0;
  totalPieces.value = 0;
  activity.value = [];
  leaderboard.value = [];
}

function onMessage(handler: MessageHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

function sendGrab(groupId: number): void {
  client?.send({ t: "grab", groupId });
}

function sendDrag(groupId: number, worldX: number, worldY: number): void {
  client?.send({ t: "drag", groupId, worldX, worldY });
}

function sendDrop(groupId: number, worldX: number, worldY: number): void {
  client?.send({ t: "drop", groupId, worldX, worldY });
}

function sendViewport(worldX: number, worldY: number, worldW: number, worldH: number): void {
  client?.send({ t: "viewport", worldX, worldY, worldW, worldH });
}

function sendCursor(worldX: number, worldY: number): void {
  client?.send({ t: "cursor", worldX, worldY });
}

// Dev controls are always visible. When the WebSocket is connected the message is
// sent directly; otherwise it is queued and the session connects (mode flips to
// contributor), flushing the queue on welcome.
function sendDev(t: DevTag): void {
  if (transport.value === "ws" && welcome && client) {
    client.send({ t });
    return;
  }
  pendingDev.push(t);
  if (transport.value !== "ws") useMode().setMode("contributor");
}

function sendDevReset(): void {
  sendDev("dev_reset");
}

function sendDevComplete(): void {
  sendDev("dev_complete");
}

function sendDevPlace(): void {
  sendDev("dev_place");
}

export function usePuzzleSession() {
  return {
    state,
    userId,
    puzzleName,
    eventStartsAt,
    totalPieces,
    lockedCount,
    activity,
    leaderboard,
    transport,
    completed,
    startContributor,
    close,
    onMessage,
    sendGrab,
    sendDrag,
    sendDrop,
    sendViewport,
    sendCursor,
    sendDevReset,
    sendDevComplete,
    sendDevPlace,
  };
}
