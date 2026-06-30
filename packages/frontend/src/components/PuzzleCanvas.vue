<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import type { ServerMessage, SpectatorKeyframe } from "@mpp/shared";
import { usePuzzleSession, type PuzzleSessionState } from "../composables/usePuzzleSession";
import { useStageControls } from "../composables/useStageControls";
import { useMinimap } from "../composables/useMinimap";
import { useMode } from "../composables/useMode";
import { useLocaleFormat } from "../i18n/format";
import { PuzzleStage, type ViewportRect } from "../canvas/puzzleStage";
import { toLeaderboardRows } from "../data/leaderboard";
import LeaderboardRow from "./LeaderboardRow.vue";

const { t } = useI18n();
const { formatNumber } = useLocaleFormat();

const host = ref<HTMLDivElement | null>(null);
const {
  state,
  userId,
  leaderboard,
  transport,
  shouldTail,
  startContributor,
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
} = usePuzzleSession();
const { setControls, setCamera, setReady } = useStageControls();
const { setMinimapSource, setMinimapNavigate } = useMinimap();
const { mode } = useMode();

let stage: PuzzleStage | null = null;
let builtEpoch = 0;
let buildChain: Promise<void> = Promise.resolve();
let unsubscribe: (() => void) | null = null;
let unsubscribeKeyframe: (() => void) | null = null;
let unsubscribeWindow: (() => void) | null = null;
// The latest spectator keyframe and the epoch whose build started the stream.
// The first keyframe drives the build; buildStage then starts the stage stream
// with it, and later keyframes re-base (only once the stream is started).
let latestSpectatorKeyframe: SpectatorKeyframe | null = null;
let spectatorStreamEpoch = 0;
const completed = ref(false);
const modalVisible = ref(true);
// True while the local player carries a cluster stuck to the cursor (double-click
// to pick up). Drives the floating carry hint.
const carrying = ref(false);

// Transient bottom-center notice (e.g. a rejected drop). A new toast resets the
// dismiss timer so repeated rejections do not stack.
const toast = ref<string | null>(null);
const TOAST_DURATION_MS = 2600;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(message: string): void {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
    toastTimer = null;
  }, TOAST_DURATION_MS);
}
// True while a build() is rebuilding the board for a new epoch. Keeps the
// loading cover up across the syncing -> ready transition and through the async
// construction and texture load, so the previous board is hidden until the new
// one is rendered.
const building = ref(false);
// Determinate progress of the in-flight build, driving the progress bar. The
// stage reports two phases: "build" (the chunked map/group/index construction,
// counted over pieces + groups) then "textures" (the first viewport's streaming
// coverage in groups). buildPhaseKind tracks which is current; the counters and
// the kind reset at the start of each build.
const buildPhaseKind = ref<"build" | "textures">("build");
const progressLoaded = ref(0);
const progressTotal = ref(0);

function triggerCompletion(playSpectacle: boolean): void {
  if (completed.value || !stage) return;
  completed.value = true;
  if (playSpectacle) stage.playEndOfPuzzle();
  stage.startConfetti();
}

// The staged-load phases shown to the player. Session states collapse onto
// these: connect (idle/connecting), manifest (loading-manifest/syncing, i.e.
// fetching the manifest and the initial piece state), build (the chunked board
// construction inside build()), textures (the async texture stream inside
// build()), ready (board on screen).
type LoadPhase = "connect" | "manifest" | "build" | "textures" | "ready";

const LOAD_PHASES: { key: LoadPhase; labelKey: string }[] = [
  { key: "connect", labelKey: "loading.stepConnect" },
  { key: "manifest", labelKey: "loading.stepManifest" },
  { key: "build", labelKey: "loading.stepBuild" },
  { key: "textures", labelKey: "loading.stepTextures" },
  { key: "ready", labelKey: "loading.stepReady" },
];

const PHASE_HEADING_KEYS: Record<LoadPhase, string> = {
  connect: "loading.headConnect",
  manifest: "loading.headManifest",
  build: "loading.headBuild",
  textures: "loading.headTextures",
  ready: "loading.headReady",
};

const loadPhase = computed<LoadPhase>(() => {
  const k = state.value.kind;
  if (k === "ready") return building.value ? buildPhaseKind.value : "ready";
  if (k === "loading-manifest" || k === "syncing") return "manifest";
  return "connect";
});

const phaseIndex = computed(() => LOAD_PHASES.findIndex((p) => p.key === loadPhase.value));
const phaseHeading = computed(() => t(PHASE_HEADING_KEYS[loadPhase.value]));
const isProgressPhase = computed(
  () => loadPhase.value === "build" || loadPhase.value === "textures",
);

const errorMessage = computed(() => (state.value.kind === "error" ? state.value.message : null));

// Admission-queue wait: the loading cover shows a place-in-line message instead of
// the staged-load steps while the client waits past the server cap.
const isQueued = computed(() => state.value.kind === "queued");
const queuePosition = computed(() => (state.value.kind === "queued" ? state.value.position : 0));

const coverKicker = computed(() => {
  if (errorMessage.value) return t("loading.error");
  if (isQueued.value) return t("queue.kicker");
  return t("loading.loading");
});
const coverHeading = computed(() => {
  if (errorMessage.value) return t("loading.couldNotLoad");
  if (isQueued.value) return t("queue.heading");
  return phaseHeading.value;
});

const showStatus = computed(() => state.value.kind !== "ready" || building.value);

// Publish playability to the shell so it can hide overlay panels until the
// board is on screen. Tracks the loading cover exactly (inverse of showStatus).
watchEffect(() => setReady(!showStatus.value));

const totalPieces = computed(() =>
  state.value.kind === "ready" || state.value.kind === "syncing"
    ? state.value.manifest.pieces.length
    : 0,
);

const loadProgress = computed(() =>
  progressTotal.value > 0 ? Math.round((progressLoaded.value / progressTotal.value) * 100) : 0,
);

const leaderboardRows = computed(() => toLeaderboardRows(leaderboard.value, userId.value));

function routeMessage(msg: ServerMessage): void {
  if (!stage) return;
  switch (msg.t) {
    case "grab_ok":
      stage.applyGrabOk(msg.groupId, msg.userId);
      stage.setPeerHeld(msg.userId, true);
      break;
    case "grab_denied":
      stage.applyGrabDenied(msg.groupId);
      break;
    case "drag":
      stage.applyRemoteDrag(msg.groupId, msg.userId, msg.worldX, msg.worldY);
      break;
    case "drop":
      stage.applyRemoteDrop(msg.groupId, msg.userId, msg.worldX, msg.worldY);
      stage.setPeerHeld(msg.userId, false);
      break;
    case "snap":
      stage.applySnap(msg.newGroupId, msg.addedPieceIds, msg.worldX, msg.worldY, msg.anchored);
      stage.setPeerHeld(msg.userId, false);
      if (totalPieces.value > 0 && msg.lockedCount >= totalPieces.value) {
        triggerCompletion(true);
      }
      break;
    case "rollback":
      stage.applyRollback(msg.groupId, msg.worldX, msg.worldY, msg.reason);
      break;
    case "join":
      stage.addPeer(msg.userId, msg.pseudo);
      break;
    case "leave":
      stage.removePeer(msg.userId);
      break;
    case "cursor":
      stage.setPeerCursor(msg.userId, msg.worldX, msg.worldY);
      break;
    case "region_state":
      stage.applyRegionState(msg.groups, msg.coverage);
      break;
    case "minimap":
      stage.setMinimapGrid(msg.grid);
      break;
    default:
      break;
  }
}

// The viewport changes on every pan and zoom tick; throttle the presence
// message so the server gets a recent visible rect without a per-frame flood.
const VIEWPORT_THROTTLE_MS = 120;
let viewportPending: ViewportRect | null = null;
let viewportLastSent = 0;
let viewportTimer: ReturnType<typeof setTimeout> | null = null;

function flushViewport(): void {
  if (viewportTimer !== null) {
    clearTimeout(viewportTimer);
    viewportTimer = null;
  }
  if (!viewportPending) return;
  viewportLastSent = performance.now();
  const vp = viewportPending;
  viewportPending = null;
  sendViewport(vp.worldX, vp.worldY, vp.worldW, vp.worldH);
}

function queueViewport(vp: ViewportRect): void {
  viewportPending = vp;
  const elapsed = performance.now() - viewportLastSent;
  if (elapsed >= VIEWPORT_THROTTLE_MS) {
    flushViewport();
  } else if (viewportTimer === null) {
    viewportTimer = setTimeout(flushViewport, VIEWPORT_THROTTLE_MS - elapsed);
  }
}

// The pointer moves continuously; throttle the cursor presence message so peers
// get a recent position without a per-event flood.
const CURSOR_THROTTLE_MS = 60;
let cursorPending: { x: number; y: number } | null = null;
let cursorLastSent = 0;
let cursorTimer: ReturnType<typeof setTimeout> | null = null;

function flushCursor(): void {
  if (cursorTimer !== null) {
    clearTimeout(cursorTimer);
    cursorTimer = null;
  }
  if (!cursorPending) return;
  cursorLastSent = performance.now();
  const c = cursorPending;
  cursorPending = null;
  sendCursor(c.x, c.y);
}

function queueCursor(x: number, y: number): void {
  cursorPending = { x, y };
  const elapsed = performance.now() - cursorLastSent;
  if (elapsed >= CURSOR_THROTTLE_MS) {
    flushCursor();
  } else if (cursorTimer === null) {
    cursorTimer = setTimeout(flushCursor, CURSOR_THROTTLE_MS - elapsed);
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
  stage.onViewportChange = (vp) => queueViewport(vp);
  stage.onCursorMove = (x, y) => queueCursor(x, y);
  stage.onNotice = (kind) => {
    if (kind === "tile_full") showToast(t("toast.tileFull"));
  };
  stage.onCarryChange = (c) => {
    carrying.value = c;
  };
  await stage.mount(host.value);
  setControls({
    zoomIn: () => stage?.zoomIn(),
    zoomOut: () => stage?.zoomOut(),
    center: () => stage?.centerView(),
    fit: () => stage?.fitView(),
  });
  setMinimapSource(() => stage?.getMinimapSnapshot() ?? null);
  setMinimapNavigate((wx, wy) => stage?.centerOnWorld(wx, wy));
  unsubscribe = onMessage(routeMessage);
  // Spectator stream wiring: the stage asks for the next sealed window, the
  // session fetches it (once, edge-cached) and feeds the events back; the stage
  // reports each applied snap so the session advances the locked count and
  // activity ticker and the canvas can fire the completion spectacle.
  stage.onNeedWindow = (t0) => void requestWindow(t0);
  stage.onSpectatorSnap = (e) => {
    recordSpectatorSnap(e);
    if (totalPieces.value > 0 && e.lockedCount >= totalPieces.value) {
      triggerCompletion(true);
    }
  };
  unsubscribeKeyframe = onKeyframe((kf) => {
    latestSpectatorKeyframe = kf;
    // The spectator minimap renders from the keyframe's grid (the contributor
    // gets the same grid over the WS `minimap` message).
    stage?.setMinimapGrid(kf.minimapGrid);
    // The first keyframe builds the stage (buildStage starts the stream); later
    // keyframes for the same build feed the re-base.
    if (stage && spectatorStreamEpoch > 0 && spectatorStreamEpoch === builtEpoch) {
      stage.ingestKeyframe(kf);
      stage.setSpectatorTailing(shouldTail.value);
    }
  });
  unsubscribeWindow = onWindowEvents((events) => stage?.ingestEvents(events));
  // Guest-first: the canvas is WS-only. It connects once a complete identity
  // exists (mode flips to contributor on a resolved session or a freshly minted
  // guest); until then the onboarding modals collect the guest pseudo + country.
  if (mode.value === "contributor") {
    await startContributor();
  }
});

// Connect when the identity becomes ready: a resolved returning session or a
// just-minted guest flips mode to contributor, which opens the WebSocket; the
// `welcome` then drives the board build on the freshly mounted stage.
watch(mode, async (next, prev) => {
  if (next === prev) return;
  close();
  if (next === "contributor") {
    await startContributor();
  }
});

async function buildStage(s: Extract<PuzzleSessionState, { kind: "ready" }>): Promise<void> {
  if (!stage || s.epoch === builtEpoch) return;
  if (builtEpoch > 0) {
    stage.clearWorld();
    completed.value = false;
    modalVisible.value = true;
  }
  builtEpoch = s.epoch;
  stage.setLocalUserId(userId.value);
  if (s.welcome.broadcastMaxCells !== undefined) {
    stage.setBroadcastMaxCells(s.welcome.broadcastMaxCells);
  }
  buildPhaseKind.value = "build";
  progressLoaded.value = 0;
  progressTotal.value = 0;
  await stage.build(s.manifest, s.pieces, s.groups, s.welcome.playZone, (p) => {
    buildPhaseKind.value = p.phase;
    progressLoaded.value = p.loaded;
    progressTotal.value = p.total;
  });
  stage.setMode(mode.value);
  // Spectator: the board is now built from the keyframe; start the stream driver
  // (render clock delayMs behind live, window tailing per the idle gate). The
  // contributor path keeps the stream inactive.
  if (transport.value === "spectator" && latestSpectatorKeyframe) {
    stage.setMinimapGrid(latestSpectatorKeyframe.minimapGrid);
    stage.startSpectatorStream(latestSpectatorKeyframe);
    stage.setSpectatorTailing(shouldTail.value);
    spectatorStreamEpoch = builtEpoch;
  }
  if (s.welcome.lockedCount >= s.manifest.pieces.length) {
    triggerCompletion(false);
  }
}

// Builds run one at a time through this chain. If `state` changes while
// build() is still awaiting its textures (e.g. dev_reset mid-load), the new
// build waits for the in-flight one: otherwise the earlier build finishes
// adding sprites after the newer build's clearWorld() ran, orphaning the
// previous puzzle on the canvas.
//
// `building` is raised here, synchronously with the ready transition, so the
// loading cover never blinks off between `state` becoming ready and the build
// actually starting. It is lowered only once the latest ready epoch is on the
// canvas, so the cover spans the async texture load too.
watch(state, (s) => {
  if (s.kind !== "ready") return;
  if (stage && s.epoch !== builtEpoch) building.value = true;
  buildChain = buildChain
    .then(() => buildStage(s))
    .catch((err) => console.error("[canvas] stage build failed", err))
    .finally(() => {
      if (state.value.kind === "ready" && state.value.epoch === builtEpoch) {
        building.value = false;
      }
    });
});

watch(mode, (m) => {
  stage?.setMode(m);
});

// Push the idle gate to the stage: tailing requests event windows; not tailing
// freezes on the keyframe (countdown before start, after completion).
watch(shouldTail, (tail) => {
  stage?.setSpectatorTailing(tail);
});

onBeforeUnmount(() => {
  unsubscribe?.();
  unsubscribe = null;
  unsubscribeKeyframe?.();
  unsubscribeKeyframe = null;
  unsubscribeWindow?.();
  unsubscribeWindow = null;
  if (viewportTimer !== null) {
    clearTimeout(viewportTimer);
    viewportTimer = null;
  }
  if (cursorTimer !== null) {
    clearTimeout(cursorTimer);
    cursorTimer = null;
  }
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  setControls(null);
  setReady(false);
  setMinimapSource(null);
  setMinimapNavigate(null);
  close();
  stage?.destroy();
  stage = null;
});
</script>

<template>
  <div ref="host" class="canvas-host">
    <div v-if="showStatus" class="status" role="status" aria-live="polite">
      <p class="kicker">{{ coverKicker }}</p>
      <p class="value">{{ coverHeading }}</p>
      <template v-if="isQueued">
        <p class="detail queue-detail">
          {{
            queuePosition > 0
              ? t("queue.position", { n: formatNumber(queuePosition) })
              : t("queue.waiting")
          }}
        </p>
        <div
          class="progress indeterminate"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div class="bar" />
        </div>
      </template>
      <template v-if="!errorMessage && !isQueued">
        <ol class="steps" aria-hidden="true">
          <li
            v-for="(phase, i) in LOAD_PHASES"
            :key="phase.key"
            :class="{ done: i < phaseIndex, active: i === phaseIndex }"
          >
            <span class="dot" />
            <span class="step-label">{{ t(phase.labelKey) }}</span>
          </li>
        </ol>
        <div
          class="progress"
          :class="{ indeterminate: !isProgressPhase }"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="isProgressPhase ? loadProgress : undefined"
        >
          <div class="bar" :style="isProgressPhase ? { width: loadProgress + '%' } : undefined" />
        </div>
        <p v-if="isProgressPhase" class="detail">
          {{ formatNumber(progressLoaded) }} / {{ formatNumber(progressTotal) }}
        </p>
        <p v-if="mode === 'contributor'" class="tip">
          <span class="tip-bulb" aria-hidden="true">💡</span>
          {{ t("loading.tip") }}
        </p>
      </template>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
    </div>
    <Transition name="completion">
      <div
        v-if="completed && modalVisible && !showStatus"
        class="completion-modal"
        role="dialog"
        aria-live="polite"
      >
        <button
          type="button"
          class="modal-close"
          :aria-label="t('completion.hideSummary')"
          @click="modalVisible = false"
        >
          ×
        </button>
        <p class="kicker">{{ t("completion.complete") }}</p>
        <p class="value">{{ t("completion.assembled") }}</p>
        <p class="meta">
          {{
            t("completion.piecesPlaced", totalPieces, { named: { n: formatNumber(totalPieces) } })
          }}
        </p>
        <div v-if="leaderboardRows.length > 0" class="completion-leaderboard">
          <p class="lb-kicker">{{ t("completion.topContributors") }}</p>
          <ol class="lb-list">
            <LeaderboardRow v-for="row in leaderboardRows" :key="row.rank" :row="row" />
          </ol>
        </div>
      </div>
    </Transition>
    <Transition name="reopen">
      <button
        v-if="completed && !modalVisible && !showStatus"
        type="button"
        class="modal-reopen"
        :aria-label="t('completion.showSummary')"
        @click="modalVisible = true"
      >
        {{ t("completion.summary") }}
      </button>
    </Transition>
    <Transition name="toast">
      <div v-if="toast" class="toast" role="status" aria-live="polite">{{ toast }}</div>
    </Transition>
    <Transition name="carry-hint">
      <div v-if="carrying && !showStatus" class="carry-hint" role="status" aria-live="polite">
        <span class="carry-dot" aria-hidden="true" />
        {{ t("carry.hint") }}
      </div>
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
  justify-items: center;
  text-align: center;
  color: var(--ink-3);
  /* Opaque cover (matching the stage backdrop) so the previous board is hidden
     during a rebuild, and pointer-events block grabs on the board being torn
     down underneath. */
  background: radial-gradient(circle at 50% 40%, #faf7f0 0%, #efeadd 70%, #e7e1d1 100%);
  pointer-events: auto;
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
.steps {
  list-style: none;
  margin: 20px 0 0;
  padding: 0;
  display: flex;
  gap: 18px;
  align-items: center;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-4);
  transition: color 200ms ease;
}
.steps .dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid var(--ink-4);
  background: transparent;
  transition:
    background 200ms ease,
    border-color 200ms ease;
}
.steps li.done {
  color: var(--ink-3);
}
.steps li.done .dot {
  background: var(--accent);
  border-color: var(--accent);
}
.steps li.active {
  color: var(--ink);
}
.steps li.active .dot {
  border-color: var(--accent);
  animation: dot-pulse 1.2s ease-in-out infinite;
}
@keyframes dot-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}
.progress {
  position: relative;
  margin-top: 20px;
  width: 280px;
  max-width: calc(100vw - 64px);
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--line);
  overflow: hidden;
}
.progress .bar {
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 180ms ease;
}
.progress.indeterminate .bar {
  width: 40%;
  animation: bar-slide 1.1s ease-in-out infinite;
}
@keyframes bar-slide {
  0% {
    transform: translateX(-110%);
  }
  100% {
    transform: translateX(280%);
  }
}
.detail {
  margin: 10px 0 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.tip {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 28px 0 0;
  max-width: 420px;
  padding: 10px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.55);
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--ink-3);
  text-align: left;
}
.tip-bulb {
  flex: none;
  font-size: 15px;
  line-height: 1;
}
.completion-modal {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 380px;
  max-width: calc(100vw - 32px);
  padding: 32px 40px;
  text-align: center;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-panel);
  backdrop-filter: blur(12px);
}
.completion-leaderboard {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed var(--line);
  text-align: left;
}
.lb-kicker {
  margin: 0 0 8px;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.completion-leaderboard .lb-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 264px;
  overflow-y: auto;
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
.toast {
  position: absolute;
  left: 50%;
  bottom: 32px;
  transform: translateX(-50%);
  max-width: min(90%, 360px);
  padding: 10px 16px;
  border-radius: 8px;
  background: rgba(38, 16, 16, 0.92);
  border: 1px solid #e0564f;
  color: #f7e9e9;
  font-size: 13px;
  text-align: center;
  pointer-events: none;
  z-index: 3;
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
.carry-hint {
  position: absolute;
  left: 50%;
  bottom: 32px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 9px;
  max-width: min(90%, 420px);
  padding: 10px 18px;
  border-radius: var(--radius-pill);
  background: rgba(28, 24, 16, 0.9);
  border: 1px solid rgba(255, 206, 71, 0.5);
  color: #f6efdd;
  font-size: 13px;
  text-align: center;
  pointer-events: none;
  z-index: 3;
}
.carry-dot {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #ffce47;
  box-shadow: 0 0 0 0 rgba(255, 206, 71, 0.7);
  animation: carry-pulse 1.4s ease-out infinite;
}
@keyframes carry-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(255, 206, 71, 0.7);
  }
  70% {
    box-shadow: 0 0 0 7px rgba(255, 206, 71, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(255, 206, 71, 0);
  }
}
.carry-hint-enter-active,
.carry-hint-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}
.carry-hint-enter-from,
.carry-hint-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
