import { ref, shallowRef } from "vue";
import type {
  GroupRuntime,
  ImageManifest,
  PieceRuntime,
  SSnap,
  SWelcome,
  ServerMessage,
} from "@mpp/shared";
import { PuzzleWsClient } from "../canvas/wsClient";

const DEFAULT_MANIFEST_URL = "/puzzle/manifest.json";
const DEFAULT_WS_URL = "ws://localhost:8080/";
const ACTIVITY_LIMIT = 6;

export type PuzzleSessionState =
  | { kind: "idle" }
  | { kind: "loading-manifest" }
  | { kind: "connecting"; manifest: ImageManifest }
  | { kind: "syncing"; manifest: ImageManifest; welcome: SWelcome }
  | {
      kind: "ready";
      manifest: ImageManifest;
      welcome: SWelcome;
      pieces: PieceRuntime[];
      groups: GroupRuntime[];
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
let started = false;
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

async function start(): Promise<void> {
  if (started) return;
  started = true;
  state.value = { kind: "loading-manifest" };
  const manifestUrl = import.meta.env.VITE_MANIFEST_URL ?? DEFAULT_MANIFEST_URL;
  let manifest: ImageManifest;
  try {
    const res = await fetch(manifestUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    manifest = (await res.json()) as ImageManifest;
  } catch (e) {
    started = false;
    state.value = {
      kind: "error",
      message: `failed to load manifest from ${manifestUrl}: ${(e as Error).message}`,
    };
    return;
  }

  puzzleName.value = manifest.name;
  state.value = { kind: "connecting", manifest };
  const wsUrl = import.meta.env.VITE_WS_URL ?? DEFAULT_WS_URL;
  client = new PuzzleWsClient(wsUrl, manifest.puzzleId);
  welcome = null;

  client.on((msg: ServerMessage) => {
    if (msg.t === "welcome") {
      welcome = msg;
      userId.value = msg.userId;
      totalPieces.value = msg.totalPieces;
      lockedCount.value = msg.lockedCount;
      state.value = { kind: "syncing", manifest, welcome };
    } else if (msg.t === "state") {
      if (!welcome) return;
      state.value = {
        kind: "ready",
        manifest,
        welcome,
        pieces: msg.pieces,
        groups: msg.groups,
      };
    } else if (msg.t === "snap") {
      recordSnap(msg);
    } else if (msg.t === "error") {
      state.value = { kind: "error", message: `${msg.code}: ${msg.message}` };
    }
    for (const h of handlers) h(msg);
  });
  client.connect();
}

function close(): void {
  client?.close();
  client = null;
  welcome = null;
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
  };
}
