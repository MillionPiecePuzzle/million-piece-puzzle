<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ServerMessage } from "@mpp/shared";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { useMode } from "../composables/useMode";
import { PuzzleStage } from "../canvas/puzzleStage";

const host = ref<HTMLDivElement | null>(null);
const { state, userId, start, onMessage, sendGrab, sendDrag, sendDrop } = usePuzzleSession();
const { mode } = useMode();

let stage: PuzzleStage | null = null;
let built = false;
let unsubscribe: (() => void) | null = null;
const completed = ref(false);
const puzzleVisible = ref(true);

function triggerCompletion(playSpectacle: boolean): void {
  if (completed.value || !stage) return;
  completed.value = true;
  if (playSpectacle) stage.playEndOfPuzzle();
  stage.startConfetti();
}

function togglePuzzleVisible(): void {
  puzzleVisible.value = !puzzleVisible.value;
  stage?.setPuzzleVisible(puzzleVisible.value);
}

const statusLabel = computed(() => {
  switch (state.value.kind) {
    case "idle":
      return "Idle";
    case "loading-manifest":
      return "Loading manifest";
    case "connecting":
      return "Connecting to server";
    case "syncing":
      return "Syncing state";
    case "ready":
      return "Ready";
    case "error":
      return "Error";
  }
});

const errorMessage = computed(() =>
  state.value.kind === "error" ? state.value.message : null,
);

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
  await stage.mount(host.value);
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
  stage?.destroy();
  stage = null;
});
</script>

<template>
  <div class="canvas-host" ref="host">
    <div v-if="showStatus" class="status" role="status">
      <p class="kicker">Status</p>
      <p class="value">{{ statusLabel }}</p>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
    </div>
    <Transition name="completion">
      <div v-if="completed" class="completion-modal" role="dialog" aria-live="polite">
        <p class="kicker">Complete</p>
        <p class="value">Puzzle assembled.</p>
        <p class="meta">{{ totalPieces.toLocaleString() }} pieces placed.</p>
        <button type="button" class="toggle" @click="togglePuzzleVisible">
          {{ puzzleVisible ? "Hide puzzle" : "Show puzzle" }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.canvas-host {
  position: absolute;
  inset: 0;
  overflow: hidden;
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
  margin: 0 0 20px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink-3);
}
.completion-modal .toggle {
  appearance: none;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 10px 18px;
  background: var(--ink);
  color: var(--paper);
  border: none;
  border-radius: var(--radius-panel);
  cursor: pointer;
  transition: opacity 150ms ease;
}
.completion-modal .toggle:hover {
  opacity: 0.85;
}
.completion-enter-active {
  transition: opacity 600ms ease 600ms, transform 600ms ease 600ms;
}
.completion-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}
.completion-enter-from,
.completion-leave-to {
  opacity: 0;
  transform: translate(-50%, calc(-50% - 12px));
}
</style>
