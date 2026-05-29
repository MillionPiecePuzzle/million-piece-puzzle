import { ref, shallowRef } from "vue";
import type {
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
  Snapshot,
} from "@mpp/shared";
import { PROTOCOL_VERSION } from "@mpp/shared";
import { PuzzleWsClient } from "../canvas/wsClient";
import { manifestUrlFor } from "../data/manifestUrl";
import { snapshotUrl } from "../data/snapshotUrl";
import { usePseudo } from "./usePseudo";

const DEFAULT_WS_URL = "ws://localhost:8080/";
const ACTIVITY_LIMIT = 6;
// Spectators fetch the snapshot on this cadence; matches the server publisher
// default (`MPP_SNAPSHOT_INTERVAL_MS=2000`) and the edge `Cache-Control`
// `max-age`, so a poll usually hits a freshly published body at the edge.
const SPECTATOR_POLL_MS = 2000;

export type Transport = "none" | "snapshot" | "ws";

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
export type SnapshotHandler = (snap: Snapshot) => void;

export type ActivityEntry = {
  id: string;
  actor: string;
  pieceCount: number;
  at: number;
};

const state = shallowRef<PuzzleSessionState>({ kind: "idle" });
const userId = ref<string | null>(null);
const puzzleName = ref<string | null>(null);
const totalPieces = ref(0);
const lockedCount = ref(0);
const activity = ref<ActivityEntry[]>([]);
const leaderboard = ref<LeaderboardEntry[]>([]);
const transport = ref<Transport>("none");

let client: PuzzleWsClient | null = null;
let welcome: SWelcome | null = null;
let manifest: ImageManifest | null = null;
let pendingState: SState | null = null;
let started = false;
let buildEpoch = 0;
const handlers = new Set<MessageHandler>();
const snapshotHandlers = new Set<SnapshotHandler>();

// Spectator polling state
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollAbort: AbortController | null = null;
let pollPuzzleId: string | null = null;

function actorLabel(id: string): string {
  return id === userId.value ? "you" : id;
}

function snapActor(msg: SSnap): string {
  if (msg.userId === userId.value) return "you";
  return msg.pseudo ?? msg.userId;
}

function recordSnap(msg: SSnap): void {
  const prev = lockedCount.value;
  lockedCount.value = msg.lockedCount;
  if (!msg.anchored) return;
  const pieceCount = msg.lockedCount - prev;
  if (pieceCount <= 0) return;
  const entry: ActivityEntry = {
    id: msg.mergeId,
    actor: snapActor(msg),
    pieceCount,
    at: msg.at,
  };
  activity.value = [entry, ...activity.value].slice(0, ACTIVITY_LIMIT);
}

function applyActivity(msg: SActivity): void {
  activity.value = msg.items
    .map((item) => ({
      id: item.id,
      actor: actorLabel(item.userId),
      pieceCount: item.lockedDelta,
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
  lockedCount.value = msg.lockedCount;
  const storedPseudo = usePseudo().pseudo.value;
  if (storedPseudo) client?.send({ t: "setPseudo", pseudo: storedPseudo });
  activity.value = [];
  leaderboard.value = [];
  pendingState = null;
  const needsLoad = !manifest || manifest.puzzleId !== msg.puzzleId;
  if (needsLoad) {
    manifest = null;
    await loadManifestFor(msg.puzzleId);
  } else if (manifest) {
    state.value = { kind: "syncing", manifest, welcome };
  }
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
    } else if (msg.t === "state") {
      if (!welcome) return;
      if (!manifest) {
        pendingState = msg;
        return;
      }
      applyState(msg);
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

// Spectator entry: poll GET /snapshot at the publisher cadence. The first
// response drives the same state machine the WS path uses (synthetic welcome +
// state), so PuzzleCanvas builds the stage exactly once. Subsequent polls of
// the same puzzleId reach subscribers via onSnapshot() and are applied in
// place by the stage. A puzzleId change resets manifest and welcome so the
// state machine rebuilds cleanly, matching what a server-driven rebuild does
// on the WS path.
async function startSpectator(): Promise<void> {
  if (started) return;
  started = true;
  transport.value = "snapshot";
  state.value = { kind: "connecting" };
  welcome = null;
  manifest = null;
  pollPuzzleId = null;

  await fetchAndDispatch();
  schedulePoll();
}

function schedulePoll(): void {
  if (!started || transport.value !== "snapshot") return;
  pollTimer = setTimeout(() => {
    void fetchAndDispatch().finally(() => schedulePoll());
  }, SPECTATOR_POLL_MS);
}

async function fetchAndDispatch(): Promise<void> {
  if (!started || transport.value !== "snapshot") return;
  pollAbort?.abort();
  pollAbort = new AbortController();
  let snap: Snapshot;
  try {
    const res = await fetch(snapshotUrl(), {
      signal: pollAbort.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      if (state.value.kind === "connecting") {
        state.value = { kind: "error", message: `snapshot ${res.status}` };
      }
      return;
    }
    snap = (await res.json()) as Snapshot;
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    if (state.value.kind === "connecting") {
      state.value = { kind: "error", message: (e as Error).message };
    }
    return;
  }

  if (snap.puzzleId !== pollPuzzleId) {
    pollPuzzleId = snap.puzzleId;
    const synthetic: SWelcome = {
      t: "welcome",
      userId: "",
      protocolVersion: PROTOCOL_VERSION,
      puzzleId: snap.puzzleId,
      lockedCount: snap.lockedCount,
      playZone: snap.playZone,
    };
    await handleWelcome(synthetic);
    if (manifest) {
      applyState({ t: "state", pieces: snap.pieces, groups: snap.groups });
    } else {
      pendingState = { t: "state", pieces: snap.pieces, groups: snap.groups };
    }
    applySnapshotStandings(snap);
    return;
  }

  lockedCount.value = snap.lockedCount;
  applySnapshotStandings(snap);
  for (const h of snapshotHandlers) h(snap);
}

// Spectators have no WebSocket, so the leaderboard and activity feed are carried
// in the polled snapshot. handleWelcome clears both on a puzzleId change, so
// this runs after it.
function applySnapshotStandings(snap: Snapshot): void {
  leaderboard.value = snap.leaderboard;
  applyActivity({ t: "activity", items: snap.activity });
}

function close(): void {
  client?.close();
  client = null;
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  pollAbort?.abort();
  pollAbort = null;
  pollPuzzleId = null;
  welcome = null;
  manifest = null;
  pendingState = null;
  started = false;
  transport.value = "none";
  state.value = { kind: "idle" };
  userId.value = null;
  lockedCount.value = 0;
  totalPieces.value = 0;
  activity.value = [];
  leaderboard.value = [];
}

function onMessage(handler: MessageHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

function onSnapshot(handler: SnapshotHandler): () => void {
  snapshotHandlers.add(handler);
  return () => snapshotHandlers.delete(handler);
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

function sendSetPseudo(pseudo: string): void {
  client?.send({ t: "setPseudo", pseudo });
}

function sendDevReset(): void {
  client?.send({ t: "dev_reset" });
}

function sendDevComplete(): void {
  client?.send({ t: "dev_complete" });
}

function sendDevPlace(): void {
  client?.send({ t: "dev_place" });
}

export function usePuzzleSession() {
  return {
    state,
    userId,
    puzzleName,
    totalPieces,
    lockedCount,
    activity,
    leaderboard,
    transport,
    startContributor,
    startSpectator,
    close,
    onMessage,
    onSnapshot,
    sendGrab,
    sendDrag,
    sendDrop,
    sendViewport,
    sendCursor,
    sendSetPseudo,
    sendDevReset,
    sendDevComplete,
    sendDevPlace,
  };
}
