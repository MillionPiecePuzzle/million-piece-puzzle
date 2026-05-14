<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ServerMessage } from "@mpp/shared";
import { usePuzzleSession, type PuzzleSessionState } from "../composables/usePuzzleSession";
import { useStageControls } from "../composables/useStageControls";
import { useMode } from "../composables/useMode";
import { PuzzleStage } from "../canvas/puzzleStage";

const host = ref<HTMLDivElement | null>(null);
const { state, userId, start, close, onMessage, sendGrab, sendDrag, sendDrop } = usePuzzleSession();
const { setControls, setCamera } = useStageControls();
const { mode } = useMode();

let stage: PuzzleStage | null = null;
let built = false;
let unsubscribe: (() => void) | null = null;
const completed = ref(false);
const modalVisible = ref(true);

function triggerCompletion(playSpectacle: boolean): void {
  if (completed.value || !stage) return;
  completed.value = true;
  if (playSpectacle) stage.playEndOfPuzzle();
  stage.startConfetti();
}

const STATUS_LABELS: Record<PuzzleSessionState["kind"], string> = {
  idle: "Idle",
  "loading-manifest": "Loading manifest",
  connecting: "Connecting to server",
  syncing: "Syncing state",
  ready: "Ready",
  error: "Error",
};

const statusLabel = computed(() => STATUS_LABELS[state.value.kind]);

const errorMessage = computed(() => (state.value.kind === "error" ? state.value.message : null));

const showStatus = computed(() => state.value.kind !== "ready");

const totalPieces = computed(() =>
  state.value.kind === "ready" || state.value.kind === "syncing"
    ? state.value.welcome.totalPieces
    : 0,
);

function routeMessage(msg: ServerMessage): void {
  if (!stage) return;
  switch (msg.t) {
    case "grab_ok":
      stage.applyGrabOk(msg.groupId, msg.userId);
      break;
    case "grab_denied":
      stage.applyGrabDenied(msg.groupId);
      break;
    case "drag":
      stage.applyRemoteDrag(msg.groupId, msg.userId, msg.worldX, msg.worldY);
      break;
    case "drop":
      stage.applyRemoteDrop(msg.groupId, msg.userId, msg.worldX, msg.worldY);
      break;
    case "snap":
      stage.applySnap(msg.newGroupId, msg.addedPieceIds, msg.worldX, msg.worldY, msg.anchored);
      if (totalPieces.value > 0 && msg.lockedCount >= totalPieces.value) {
        triggerCompletion(true);
      }
      break;
    case "rollback":
      stage.applyRollback(msg.groupId, msg.worldX, msg.worldY);
      break;
    default:
      break;
  }
}

onMounted(async () => {
  if (!host.value) return;
  stage = new PuzzleStage();
  stage.setMode(mode.value);
  stage.setCallbacks({
    onGrab: (groupId) => sendGrab(groupId),
    onDrag: (groupId, x, y) => sendDrag(groupId, x, y),
    onDrop: (groupId, x, y) => sendDrop(groupId, x, y),
  });
  stage.onCameraChange = (camera) => setCamera(camera);
  await stage.mount(host.value);
  setControls({
    zoomIn: () => stage?.zoomIn(),
    zoomOut: () => stage?.zoomOut(),
    center: () => stage?.centerView(),
    fit: () => stage?.fitView(),
  });
  unsubscribe = onMessage(routeMessage);
  await start();
});

watch(state, async (s) => {
  if (s.kind !== "ready" || built || !stage) return;
  built = true;
  stage.setLocalUserId(userId.value);
  await stage.build(s.manifest, s.pieces, s.groups);
  stage.setMode(mode.value);
  if (s.welcome.lockedCount >= s.welcome.totalPieces) {
    triggerCompletion(false);
  }
});

watch(mode, (m) => {
  stage?.setMode(m);
});

onBeforeUnmount(() => {
  unsubscribe?.();
  unsubscribe = null;
  setControls(null);
  close();
  stage?.destroy();
  stage = null;
});
</script>

<template>
  <div ref="host" class="canvas-host">
    <div v-if="showStatus" class="status" role="status">
      <p class="kicker">Status</p>
      <p class="value">{{ statusLabel }}</p>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
    </div>
    <Transition name="completion">
      <div
        v-if="completed && modalVisible"
        class="completion-modal"
        role="dialog"
        aria-live="polite"
      >
        <button
          type="button"
          class="modal-close"
          aria-label="Hide summary"
          @click="modalVisible = false"
        >
          ×
        </button>
        <p class="kicker">Complete</p>
        <p class="value">Puzzle assembled.</p>
        <p class="meta">{{ totalPieces.toLocaleString() }} pieces placed.</p>
      </div>
    </Transition>
    <Transition name="reopen">
      <button
        v-if="completed && !modalVisible"
        type="button"
        class="modal-reopen"
        aria-label="Show summary"
        @click="modalVisible = true"
      >
        Summary
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.canvas-host {
  position: absolute;
  inset: 0;
  overflow: hidden;
  /* Lift the (transparent) canvas above the stage backdrop pseudo-elements so
     pieces render over the hairline grid instead of under it. */
  z-index: 1;
}
.canvas-host :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
.status {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
  color: var(--ink-3);
  pointer-events: none;
}
.status .kicker {
  margin: 0 0 4px;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.status .value {
  margin: 0;
  font-family: var(--serif);
  font-size: 24px;
  color: var(--ink);
}
.status .error {
  margin: 12px 0 0;
  font-family: var(--mono);
  font-size: 12px;
  color: oklch(0.55 0.18 30);
  max-width: 480px;
}
.completion-modal {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  min-width: 320px;
  padding: 32px 40px;
  text-align: center;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-panel);
  backdrop-filter: blur(12px);
}
.modal-close {
  position: absolute;
  top: 8px;
  right: 10px;
  appearance: none;
  background: none;
  border: none;
  padding: 4px 8px;
  font-size: 20px;
  line-height: 1;
  color: var(--ink-4);
  cursor: pointer;
  transition: color 150ms ease;
}
.modal-close:hover {
  color: var(--ink);
}
.modal-reopen {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  appearance: none;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.85);
  color: var(--ink-3);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition:
    color 150ms ease,
    background 150ms ease;
}
.modal-reopen:hover {
  color: var(--ink);
  background: rgba(255, 255, 255, 0.98);
}
.completion-modal .kicker {
  margin: 0 0 8px;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
}
.completion-modal .value {
  margin: 0 0 6px;
  font-family: var(--serif);
  font-size: 28px;
  color: var(--ink);
}
.completion-modal .meta {
  margin: 0;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink-3);
}
.completion-enter-active {
  transition:
    opacity 400ms ease,
    transform 400ms ease;
}
.completion-leave-active {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}
.completion-enter-from,
.completion-leave-to {
  opacity: 0;
  transform: translate(-50%, calc(-50% - 12px));
}
.reopen-enter-active {
  transition:
    opacity 300ms ease 150ms,
    transform 300ms ease 150ms;
}
.reopen-leave-active {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}
.reopen-enter-from,
.reopen-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px);
}
</style>
