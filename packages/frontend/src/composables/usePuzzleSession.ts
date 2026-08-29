import { computed, ref, shallowRef } from "vue";
import type {
  ActivityItem,
  ImageManifest,
  LeaderboardEntry,
  QueueStatusResponse,
  QueueTicketResponse,
  SActivity,
  SError,
  SSnap,
  SWelcome,
  ServerMessage,
} from "@mpp/shared";
import { WS_CLOSE_SERVICE_RESTART } from "@mpp/shared";
import type { InitialGroupSpec } from "../canvas/puzzleStage";
import { PuzzleWsClient, type WsCloseInfo } from "../canvas/wsClient";
import { backendReachable, backendRetryDelayMs } from "../data/landing";
import { mergeLeaderboardDelta } from "../data/contributors";
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
      groups: InitialGroupSpec[];
      epoch: number;
    }
  // The error state carries an i18n key, not a sentence: the message is shown to
  // players in their own locale, and the technical detail (urls, server text)
  // goes to the console instead of the screen.
  | { kind: "error"; messageKey: string }
  // The server is down: restarting for a deploy, or unreachable. Distinct from
  // `error` because nothing is wrong on the player's side and nothing is asked of
  // them: the session watches for the server to come back and reloads by itself.
  | { kind: "maintenance" };

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
// The local contributor's own standing while they rank outside the standings
// list above, which then carries no row for them. Null while they are inside it
// (the list is the finer answer) and until the server has sent one.
const myStanding = ref<{ pieces: number; rank: number } | null>(null);
const onlineCount = ref(0);
const transport = ref<Transport>("none");
// The puzzle is finished once every piece is locked. Derived so the shell can
// gate the contributor entry points (Contribute card, auth modal) on it.
const completed = computed(() => totalPieces.value > 0 && lockedCount.value >= totalPieces.value);

let client: PuzzleWsClient | null = null;
let welcome: SWelcome | null = null;
let manifest: ImageManifest | null = null;
let started = false;
// Admission-queue gate: an in-flight ticket/status fetch, the poll-delay timer,
// and the delay's resolver, all torn down by close() so leaving the queue cancels
// promptly (the resolver unblocks a pending delay so the gate loop exits at once).
let queueAbort: AbortController | null = null;
let queueTimer: ReturnType<typeof setTimeout> | null = null;
let queueDelayResolve: (() => void) | null = null;
// Pending backend probe while the session sits on the maintenance screen.
let maintenanceTimer: ReturnType<typeof setTimeout> | null = null;
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

function buildEmptyBoard(): void {
  if (!welcome || !manifest) return;
  buildEpoch += 1;
  state.value = {
    kind: "ready",
    manifest,
    welcome,
    groups: [],
    epoch: buildEpoch,
  };
}

function handleServerError(msg: SError): void {
  if (msg.code === "protocol_mismatch") {
    console.error(`puzzle session: ${msg.code}: ${msg.message}`);
    state.value = { kind: "error", messageKey: "loading.errorProtocol" };
    return;
  }
  if (msg.code === "maintenance") {
    console.warn(`puzzle session: ${msg.code}: ${msg.message}`);
    enterMaintenance();
    return;
  }
  console.warn(`puzzle session: transient server error ${msg.code}: ${msg.message}`);
}

// Park the session until the server is back. Reached from the shutdown notice,
// from the 1012 close frame behind it, and from a queue request that finds the
// host unreachable, so a deploy, a crash and an outage all land here.
function enterMaintenance(): void {
  if (state.value.kind === "maintenance") return;
  client?.close();
  client = null;
  cancelQueueGate();
  welcome = null;
  manifest = null;
  started = false;
  transport.value = "none";
  state.value = { kind: "maintenance" };
  scheduleBackendProbe();
}

// The server answering again almost always means a fresh deploy, so recovery is
// a page reload, not a reconnect: the bundle, the board and the protocol version
// come back in step instead of an old client resyncing against a new server.
function scheduleBackendProbe(): void {
  if (maintenanceTimer !== null) return;
  maintenanceTimer = setTimeout(() => {
    maintenanceTimer = null;
    void backendReachable().then((up) => {
      if (state.value.kind !== "maintenance") return;
      if (up) window.location.reload();
      else scheduleBackendProbe();
    });
  }, backendRetryDelayMs());
}

function cancelBackendProbe(): void {
  if (maintenanceTimer === null) return;
  clearTimeout(maintenanceTimer);
  maintenanceTimer = null;
}

async function loadManifestFor(puzzleId: string): Promise<void> {
  const url = manifestUrlFor(puzzleId);
  state.value = { kind: "loading-manifest", puzzleId };
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    manifest = (await res.json()) as ImageManifest;
  } catch (e) {
    console.error(`puzzle session: failed to load manifest from ${url}: ${(e as Error).message}`);
    state.value = { kind: "error", messageKey: "loading.errorManifest" };
    return;
  }
  puzzleName.value = manifest.name;
  totalPieces.value = manifest.pieces.length;
  if (welcome) {
    state.value = { kind: "syncing", manifest, welcome };
  }
}

async function handleWelcome(msg: SWelcome): Promise<void> {
  welcome = msg;
  userId.value = msg.userId;
  eventStartsAt.value = msg.eventStartsAt;
  lockedCount.value = msg.lockedCount;
  onlineCount.value = msg.count;
  activity.value = [];
  leaderboard.value = [];
  myStanding.value = null;
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
    buildEmptyBoard();
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
    if (!started) return;
    if (e instanceof BackendUnavailableError) {
      console.warn(`puzzle session: server unreachable: ${e.message}`);
      enterMaintenance();
      return;
    }
    console.error(`puzzle session: failed to join the queue: ${(e as Error).message}`);
    state.value = { kind: "error", messageKey: "loading.errorQueue" };
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

// The host not answering at all (no response, or a 5xx from the edge in front of
// a stopped container) means the server is down, not that the queue refused. It
// takes the client to the maintenance screen instead of a "check your connection"
// error, which would blame the player for a restart we caused.
class BackendUnavailableError extends Error {}

async function fetchQueue(url: string, init?: RequestInit): Promise<Response> {
  const abort = new AbortController();
  queueAbort = abort;
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: abort.signal });
  } catch (e) {
    throw new BackendUnavailableError((e as Error).message);
  }
  if (res.status >= 500) throw new BackendUnavailableError(`status ${res.status}`);
  return res;
}

async function postQueueTicket(): Promise<QueueTicketResponse> {
  const res = await fetchQueue(queueTicketUrl(), { method: "POST" });
  if (!res.ok) throw new Error(`queue ticket ${res.status}`);
  return (await res.json()) as QueueTicketResponse;
}

async function getQueueStatus(ticket: string): Promise<QueueStatusResponse> {
  const res = await fetchQueue(queueStatusUrl(ticket));
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
      if (msg.entries.some((e) => e.userId === userId.value)) myStanding.value = null;
    } else if (msg.t === "leaderboard_delta") {
      leaderboard.value = mergeLeaderboardDelta(leaderboard.value, msg.entries);
      if (msg.entries.some((e) => e.userId === userId.value)) myStanding.value = null;
    } else if (msg.t === "standing") {
      myStanding.value = { pieces: msg.pieces, rank: msg.rank };
    } else if (msg.t === "join" || msg.t === "leave") {
      onlineCount.value = msg.count;
    } else if (msg.t === "error") {
      handleServerError(msg);
    }
    for (const h of handlers) h(msg);
  });

  client.onClose((info) => {
    if (info.intentional) return;
    // The shutdown notice usually arrives first and has already switched the
    // session over; this catches the run where only the close frame made it.
    if (info.code === WS_CLOSE_SERVICE_RESTART) {
      console.warn("puzzle session: server restarting");
      enterMaintenance();
      return;
    }
    welcome = null;
    manifest = null;
    started = false;
    if (state.value.kind === "error" || state.value.kind === "maintenance") return;
    console.error(`puzzle session: connection lost to ${wsUrl} (${describeClose(info)})`);
    state.value = { kind: "error", messageKey: "loading.errorConnection" };
  });

  client.connect();
}

// The console line is the only record of why a session ended, so it carries what
// tells the causes apart: the close code (1006 reap or network fault, 1013 slow
// consumer), and how long this tab went unserviced, which is what a browser
// freezing a background tab looks like from in here.
function describeClose(info: WsCloseInfo): string {
  const parts = [
    `code=${info.code}`,
    `clean=${info.wasClean}`,
    `age=${Math.round(info.ageMs / 1000)}s`,
    `stalled=${Math.round(info.stalledMs / 1000)}s`,
    `hidden=${info.hidden}`,
  ];
  if (info.reason) parts.push(`reason=${info.reason}`);
  return parts.join(" ");
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
  cancelBackendProbe();
  welcome = null;
  manifest = null;
  started = false;
  transport.value = "none";
  state.value = { kind: "idle" };
  userId.value = null;
  eventStartsAt.value = 0;
  lockedCount.value = 0;
  totalPieces.value = 0;
  activity.value = [];
  leaderboard.value = [];
  myStanding.value = null;
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

// A drop on a HUD flag: the point is the flag's foot and the server answers with
// the position the cluster lands at, resolved against the whole board.
function sendDropNear(groupId: number, worldX: number, worldY: number): void {
  client?.send({ t: "drop_near", groupId, worldX, worldY });
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
    myStanding,
    onlineCount,
    transport,
    completed,
    startContributor,
    enterMaintenance,
    close,
    onMessage,
    sendGrab,
    sendDrag,
    sendDrop,
    sendDropNear,
    sendViewport,
    sendCursor,
    sendDevReset,
    sendDevComplete,
    sendDevPlace,
  };
}
