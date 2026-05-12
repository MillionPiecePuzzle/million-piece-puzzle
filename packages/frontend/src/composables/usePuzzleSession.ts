import { onBeforeUnmount, ref, shallowRef } from "vue";
import type {
  GroupRuntime,
  ImageManifest,
  PieceRuntime,
  SWelcome,
  ServerMessage,
} from "@mpp/shared";
import { PuzzleWsClient } from "../canvas/wsClient";

const DEFAULT_MANIFEST_URL = "/puzzle/manifest.json";
const DEFAULT_WS_URL = "ws://localhost:8080/";

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

export function usePuzzleSession() {
  const state = shallowRef<PuzzleSessionState>({ kind: "idle" });
  const pieces = ref<PieceRuntime[]>([]);
  const groups = ref<GroupRuntime[]>([]);
  let client: PuzzleWsClient | null = null;

  async function start(): Promise<void> {
    state.value = { kind: "loading-manifest" };
    const manifestUrl = import.meta.env.VITE_MANIFEST_URL ?? DEFAULT_MANIFEST_URL;
    let manifest: ImageManifest;
    try {
      const res = await fetch(manifestUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      manifest = (await res.json()) as ImageManifest;
    } catch (e) {
      state.value = {
        kind: "error",
        message: `failed to load manifest from ${manifestUrl}: ${(e as Error).message}`,
      };
      return;
    }

    state.value = { kind: "connecting", manifest };
    const wsUrl = import.meta.env.VITE_WS_URL ?? DEFAULT_WS_URL;
    client = new PuzzleWsClient(wsUrl, manifest.puzzleId);

    let welcome: SWelcome | null = null;
    client.on((msg: ServerMessage) => {
      if (msg.t === "welcome") {
        welcome = msg;
        state.value = { kind: "syncing", manifest, welcome };
      } else if (msg.t === "state") {
        if (!welcome) return;
        pieces.value = msg.pieces;
        groups.value = msg.groups;
        state.value = {
          kind: "ready",
          manifest,
          welcome,
          pieces: msg.pieces,
          groups: msg.groups,
        };
      } else if (msg.t === "error") {
        state.value = { kind: "error", message: `${msg.code}: ${msg.message}` };
      }
    });
    client.connect();
  }

  onBeforeUnmount(() => {
    client?.close();
    client = null;
  });

  return { state, pieces, groups, start };
}
