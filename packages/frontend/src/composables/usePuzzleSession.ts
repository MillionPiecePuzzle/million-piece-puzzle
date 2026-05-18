import { ref, shallowRef } from "vue";
import type {
  GroupRuntime,
  ImageManifest,
  PieceRuntime,
  SSnap,
  SState,
  SWelcome,
  ServerMessage,
} from "@mpp/shared";
import { PuzzleWsClient } from "../canvas/wsClient";
import { manifestUrlFor } from "../data/manifestUrl";

const DEFAULT_WS_URL = "ws://localhost:8080/";
const ACTIVITY_LIMIT = 6;

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

export type ActivityEntry = {
  id: number;
  actor: string;
  pieceNumber: number;
  at: number;
};

const state = shallowRef<PuzzleSessionState>({ kind: "idle" });
const userId = ref<string | null>(null);
const puzzleName = ref<string | null>(null);
const totalPieces = ref(0);
const lockedCount = ref(0);
const activity = ref<ActivityEntry[]>([]);

let client: PuzzleWsClient | null = null;
let welcome: SWelcome | null = null;
let manifest: ImageManifest | null = null;
// The server sends `welcome` then `state` back-to-back. We await the manifest
// fetch on welcome, so the state can land before manifest is ready. Buffer it
// here and apply once the manifest resolves.
let pendingState: SState | null = null;
let started = false;
let buildEpoch = 0;
const handlers = new Set<MessageHandler>();

function recordSnap(msg: SSnap): void {
  const prev = lockedCount.value;
  lockedCount.value = msg.lockedCount;
  if (msg.lockedCount <= prev) return;
  const actor = msg.userId === userId.value ? "you" : msg.userId;
  const fresh: ActivityEntry[] = [];
  for (let n = msg.lockedCount; n > prev; n--) {
    fresh.push({ id: n, actor, pieceNumber: n, at: msg.at });
  }
  activity.value = [...fresh, ...activity.value].slice(0, ACTIVITY_LIMIT);
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
  // A second welcome on the same connection means the server cycled to the
  // next puzzle. We treat both cases identically: reset local progress, load
  // the new manifest, wait for the fresh state.
  welcome = msg;
  userId.value = msg.userId;
  lockedCount.value = msg.lockedCount;
  activity.value = [];
  pendingState = null;
  const needsLoad = !manifest || manifest.puzzleId !== msg.puzzleId;
  if (needsLoad) {
    manifest = null;
    await loadManifestFor(msg.puzzleId);
  } else if (manifest) {
    state.value = { kind: "syncing", manifest, welcome };
  }
}

async function start(): Promise<void> {
  if (started) return;
  started = true;
  state.value = { kind: "connecting" };
  // `||` (not `??`) so docker-compose's `VITE_WS_URL: "${VITE_WS_URL:-}"`
  // empty-string default falls back to the local default instead of producing
  // a relative URL that resolves to the Vite host.
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
    } else if (msg.t === "error") {
      state.value = { kind: "error", message: `${msg.code}: ${msg.message}` };
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

function close(): void {
  client?.close();
  client = null;
  welcome = null;
  manifest = null;
  pendingState = null;
  started = false;
  state.value = { kind: "idle" };
  userId.value = null;
  lockedCount.value = 0;
  totalPieces.value = 0;
  activity.value = [];
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

function sendDevReset(): void {
  client?.send({ t: "dev_reset" });
}

function sendDevComplete(): void {
  client?.send({ t: "dev_complete" });
}

export function usePuzzleSession() {
  return {
    state,
    userId,
    puzzleName,
    totalPieces,
    lockedCount,
    activity,
    start,
    close,
    onMessage,
    sendGrab,
    sendDrag,
    sendDrop,
    sendDevReset,
    sendDevComplete,
  };
}
