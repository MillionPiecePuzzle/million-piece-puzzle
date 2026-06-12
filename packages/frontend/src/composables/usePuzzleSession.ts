import { computed, ref, shallowRef } from "vue";
import type {
  ActivityItem,
  GroupRuntime,
  ImageManifest,
  LeaderboardEntry,
  PieceRuntime,
  SActivity,
  SError,
  SSnap,
  SState,
  SWelcome,
  ServerMessage,
  SpectatorEvent,
  SpectatorEventWindow,
  SpectatorKeyframe,
  SpectatorSnapEvent,
} from "@mpp/shared";
import { PROTOCOL_VERSION, SPECTATOR_FORMAT_VERSION } from "@mpp/shared";
import { PuzzleWsClient } from "../canvas/wsClient";
import { manifestUrlFor } from "../data/manifestUrl";
import { eventsUrl, keyframeUrl } from "../data/spectatorUrl";
import { useMode } from "./useMode";

const DEFAULT_WS_URL = "ws://localhost:8080/";
const ACTIVITY_LIMIT = 6;
// Spectator keyframe refetch cadence, feeding the stage's re-base. Mirrors the
// server default (`MPP_KEYFRAME_INTERVAL_MS=300000`); if they differ the re-base
// just heals more or less often. While idle (before the event start or after
// completion) the keyframe is slow-polled instead, to pick up the start/reset
// transition promptly without tailing windows.
const KEYFRAME_REFETCH_MS = 300_000;
const KEYFRAME_IDLE_POLL_MS = 10_000;

export type Transport = "none" | "spectator" | "ws";

export type PuzzleSessionState =
  | { kind: "idle" }
  | { kind: "connecting" }
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
export type KeyframeHandler = (keyframe: SpectatorKeyframe) => void;
export type WindowHandler = (events: SpectatorEvent[]) => void;

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
// Unix ms the event started at, mirrored from welcome/keyframe. 0 means no
// scheduled start. Drives the top bar's live play-time counter.
const eventStartsAt = ref(0);
const totalPieces = ref(0);
const lockedCount = ref(0);
const activity = ref<ActivityEntry[]>([]);
const leaderboard = ref<LeaderboardEntry[]>([]);
const transport = ref<Transport>("none");
// Whether the spectator should tail event windows. False before the event start
// (countdown) and after completion: the board is the frozen keyframe and no
// windows are fetched. Mirrors the server idle gate; drives the stage's window
// requests through PuzzleCanvas.
const shouldTail = ref(false);
// The puzzle is finished once every piece is locked. Derived so the shell can
// gate the contributor entry points (Contribute card, auth modal) on it.
const completed = computed(() => totalPieces.value > 0 && lockedCount.value >= totalPieces.value);

let client: PuzzleWsClient | null = null;
let welcome: SWelcome | null = null;
let manifest: ImageManifest | null = null;
let pendingState: SState | null = null;
let started = false;
let buildEpoch = 0;
const handlers = new Set<MessageHandler>();
const keyframeHandlers = new Set<KeyframeHandler>();
const windowHandlers = new Set<WindowHandler>();
// Dev messages clicked while in spectator mode (no WebSocket). They are queued
// here and flushed once the upgrade to a contributor connection delivers the
// welcome, so the dev controls work regardless of transport.
type DevTag = "dev_reset" | "dev_complete" | "dev_place";
let pendingDev: DevTag[] = [];

// Spectator stream state. The keyframe is refetched on a timer (re-base feed
// while tailing, idle-poll for the start/reset transition otherwise); each event
// window is fetched at most once and cached at the edge (immutable).
let streamPuzzleId: string | null = null;
let latestKeyframe: SpectatorKeyframe | null = null;
let keyframeTimer: ReturnType<typeof setTimeout> | null = null;
let keyframeAbort: AbortController | null = null;
const requestedWindows = new Set<number>();
const windowAborts = new Set<AbortController>();

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
  // Contributor (protocol v3): welcome carries no board, so build an empty board
  // now and let groups stream in per viewport via region_state. The spectator path
  // drives applyState from the keyframe instead, so it is left untouched here.
  if (transport.value === "ws" && manifest && welcome) {
    applyState({ t: "state", pieces: [], groups: [] });
  }
}

// The connection is open by the time welcome arrives, so any dev message queued
// during a spectator-to-contributor upgrade can be sent now.
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
  const wsUrl = import.meta.env.VITE_WS_URL || DEFAULT_WS_URL;
  client = new PuzzleWsClient(wsUrl);
  welcome = null;
  manifest = null;

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

// Spectator entry: load the keyframe, then tail immutable event windows a few
// seconds behind live. The first keyframe drives the same state machine the WS
// path uses (synthetic welcome + state), so PuzzleCanvas builds the stage exactly
// once and then starts the stage's stream driver. Subsequent keyframes feed the
// stage's re-base, and the idle gate (shouldTail) pauses window tailing before
// the event start and after completion.
async function startSpectator(): Promise<void> {
  if (started) return;
  started = true;
  transport.value = "spectator";
  state.value = { kind: "connecting" };
  welcome = null;
  manifest = null;
  streamPuzzleId = null;
  latestKeyframe = null;
  requestedWindows.clear();
  await fetchKeyframe();
  scheduleKeyframeRefetch();
}

function scheduleKeyframeRefetch(): void {
  if (!started || transport.value !== "spectator") return;
  const delay = shouldTail.value ? KEYFRAME_REFETCH_MS : KEYFRAME_IDLE_POLL_MS;
  keyframeTimer = setTimeout(() => {
    void fetchKeyframe().finally(() => scheduleKeyframeRefetch());
  }, delay);
}

async function fetchKeyframe(): Promise<void> {
  if (!started || transport.value !== "spectator") return;
  keyframeAbort?.abort();
  keyframeAbort = new AbortController();
  let kf: SpectatorKeyframe;
  try {
    const res = await fetch(keyframeUrl(), { signal: keyframeAbort.signal, cache: "no-store" });
    if (!res.ok) {
      if (state.value.kind === "connecting") {
        state.value = { kind: "error", message: `keyframe ${res.status}` };
      }
      return;
    }
    kf = (await res.json()) as SpectatorKeyframe;
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    if (state.value.kind === "connecting") {
      state.value = { kind: "error", message: (e as Error).message };
    }
    return;
  }
  if (kf.v !== SPECTATOR_FORMAT_VERSION) {
    state.value = {
      kind: "error",
      message: `spectator format v${kf.v}, expected v${SPECTATOR_FORMAT_VERSION}`,
    };
    return;
  }
  applyKeyframe(kf);
}

function applyKeyframe(kf: SpectatorKeyframe): void {
  latestKeyframe = kf;
  updateTailGate(kf);
  if (kf.puzzleId !== streamPuzzleId) {
    // First keyframe (or a puzzleId change): drive the state machine to build the
    // stage once, exactly like the WS welcome + state path.
    streamPuzzleId = kf.puzzleId;
    const synthetic: SWelcome = {
      t: "welcome",
      userId: "",
      protocolVersion: PROTOCOL_VERSION,
      puzzleId: kf.puzzleId,
      lockedCount: kf.lockedCount,
      playZone: kf.playZone,
      eventStartsAt: kf.eventStartsAt,
    };
    void handleWelcome(synthetic);
    if (manifest) {
      applyState({ t: "state", pieces: kf.pieces, groups: kf.groups });
    } else {
      pendingState = { t: "state", pieces: kf.pieces, groups: kf.groups };
    }
  }
  // lockedCount only grows: a fresh keyframe is older than the live tail, so it
  // never regresses the count the snap events advanced.
  lockedCount.value = Math.max(lockedCount.value, kf.lockedCount);
  leaderboard.value = kf.leaderboard;
  applyActivity({ t: "activity", items: kf.activity });
  for (const h of keyframeHandlers) h(kf);
}

// Tail event windows only while the event is live: started (or no schedule) and
// not yet complete. Matches the server idle gate, so the client stops fetching
// windows in the same states the server stops regenerating the keyframe.
function updateTailGate(kf: SpectatorKeyframe): void {
  const startedOrNoSchedule = kf.eventStartsAt === 0 || Date.now() >= kf.eventStartsAt;
  const notComplete = Math.max(lockedCount.value, kf.lockedCount) < kf.totalPieces;
  shouldTail.value = startedOrNoSchedule && notComplete;
}

// Fetch one sealed event window (each at most once) and hand its events to the
// stage. Windows are immutable, so a repeat hits the edge cache. A failure
// (not-yet-sealed, out of retention, network) is left to the next keyframe
// re-base to heal rather than retried, keeping the fetch path single-shot.
async function requestWindow(t0: number): Promise<void> {
  if (!started || transport.value !== "spectator") return;
  if (requestedWindows.has(t0)) return;
  requestedWindows.add(t0);
  const abort = new AbortController();
  windowAborts.add(abort);
  try {
    const res = await fetch(eventsUrl(t0), { signal: abort.signal });
    if (!res.ok) return;
    const win = (await res.json()) as SpectatorEventWindow;
    if (win.v !== SPECTATOR_FORMAT_VERSION) return;
    if (win.events.length > 0) for (const h of windowHandlers) h(win.events);
  } catch {
    // Swallowed: a missed window is healed by the next keyframe re-base.
  } finally {
    windowAborts.delete(abort);
  }
}

// Update the spectator's locked count and activity ticker from a stage-applied
// snap event (live tail or join catch-up). Mirrors the WS snap path via
// recordSnap, then re-checks the tail gate so a completing snap stops tailing.
function recordSpectatorSnap(e: SpectatorSnapEvent): void {
  recordSnap({
    t: "snap",
    mergeId: e.mergeId,
    newGroupId: e.newGroupId,
    addedPieceIds: e.addedPieceIds,
    worldX: e.worldX,
    worldY: e.worldY,
    anchored: e.anchored,
    droppedSize: e.droppedSize,
    mergedSize: e.mergedSize,
    userId: e.userId,
    pseudo: e.pseudo,
    at: e.at,
    lockedCount: e.lockedCount,
  });
  if (latestKeyframe) updateTailGate(latestKeyframe);
}

function close(): void {
  client?.close();
  client = null;
  if (keyframeTimer !== null) {
    clearTimeout(keyframeTimer);
    keyframeTimer = null;
  }
  keyframeAbort?.abort();
  keyframeAbort = null;
  for (const a of windowAborts) a.abort();
  windowAborts.clear();
  requestedWindows.clear();
  streamPuzzleId = null;
  latestKeyframe = null;
  shouldTail.value = false;
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

function onKeyframe(handler: KeyframeHandler): () => void {
  keyframeHandlers.add(handler);
  return () => keyframeHandlers.delete(handler);
}

function onWindowEvents(handler: WindowHandler): () => void {
  windowHandlers.add(handler);
  return () => windowHandlers.delete(handler);
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

// Dev controls are always visible, including in spectator mode where there is
// no WebSocket. Sending a dev message then upgrades the session to a contributor
// connection and queues the message to flush on welcome; once connected it sends
// directly.
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
    shouldTail,
    completed,
    startContributor,
    startSpectator,
    close,
    onMessage,
    onKeyframe,
    onWindowEvents,
    requestWindow,
    recordSpectatorSnap,
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
