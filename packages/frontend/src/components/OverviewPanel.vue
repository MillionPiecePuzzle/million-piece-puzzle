<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  MIN_OVERVIEW_ASPECT,
  drawOverview,
  overviewAspect,
  type MapTransform,
} from "../canvas/overviewView";
import { useOverview } from "../composables/useOverview";
import { useBoardFlags } from "../composables/useBoardFlags";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { useRafLoop } from "../composables/useRafLoop";
import OverviewModal from "./OverviewModal.vue";

const { t } = useI18n();
const { source, navigate } = useOverview();
const { flags } = useBoardFlags();
const { onlineCount } = usePuzzleSession();
const canvasEl = ref<HTMLCanvasElement | null>(null);
const ready = ref(false);
const dragging = ref(false);
const enlarged = ref(false);

// Last canvas->world mapping the draw loop produced, captured so a pointer press
// can invert it without recomputing the layout. Null until the first real frame.
let transform: MapTransform | null = null;

const canvasAspect = ref(MIN_OVERVIEW_ASPECT);

function draw(): void {
  // The enlarged view covers the HUD with its own backdrop and paints the same
  // map, so the panel stops working entirely while it is open rather than
  // building the overview twice a frame: the snapshot costs as much as the
  // paint it feeds, both scaling with the known-piece count, which runs into
  // thousands of dots on the 1M board. `ready` cannot go stale meanwhile: the
  // view only opens from a panel that is already showing.
  if (enlarged.value) return;

  // The overview stays hidden until the stage has a play zone, so it never
  // shows a placeholder shape that would resize once real data arrives.
  const snap = source.value?.() ?? null;
  ready.value = snap !== null;
  if (!snap) return;

  // Shaped to the play zone plus its out-of-bounds band, so the map fills the
  // canvas with no letterbox. Set before painting, so the panel appears at its
  // final shape rather than resizing after its first frame.
  const aspect = overviewAspect(snap);
  if (aspect === null) return;
  canvasAspect.value = aspect;

  const canvas = canvasEl.value;
  if (!canvas) return;
  const next = drawOverview(canvas, snap, flags.value);
  if (next) transform = next;
}

// Invert the draw loop's mapping: pointer (CSS px relative to the canvas) ->
// device px -> world. Works for out-of-bounds points too, so a drag past the
// panel edge keeps pushing the camera until applyCamera's clamp stops it.
function pointerToWorld(ev: PointerEvent): { x: number; y: number } | null {
  const canvas = canvasEl.value;
  if (!canvas || !transform) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const cx = (ev.clientX - rect.left) * (canvas.width / rect.width);
  const cy = (ev.clientY - rect.top) * (canvas.height / rect.height);
  const t = transform;
  return {
    x: (cx - t.offX) / t.scale + t.zoneMinX - t.margin,
    y: (cy - t.offY) / t.scale + t.zoneMinY - t.margin,
  };
}

function onPointerDown(ev: PointerEvent): void {
  if (ev.button !== 0) return;
  const world = pointerToWorld(ev);
  if (!world) return;
  dragging.value = true;
  // Capture so the sweep keeps tracking the pointer once it leaves the panel.
  canvasEl.value?.setPointerCapture(ev.pointerId);
  navigate.value?.(world.x, world.y);
  ev.preventDefault();
}

function onPointerMove(ev: PointerEvent): void {
  if (!dragging.value) return;
  const world = pointerToWorld(ev);
  if (world) navigate.value?.(world.x, world.y);
}

function onPointerUp(ev: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  canvasEl.value?.releasePointerCapture(ev.pointerId);
}

useRafLoop(draw);
</script>

<template>
  <aside
    v-show="ready"
    class="panel overview"
    :style="{ '--ar': canvasAspect }"
    :aria-label="t('overview.title')"
  >
    <div class="overview-head">
      <h3>{{ t("overview.title") }}</h3>
      <div class="overview-head-right">
        <span
          v-if="onlineCount >= 2"
          class="online-count"
          :title="t('overview.online', { n: onlineCount })"
        >
          <span class="online-dot" aria-hidden="true"></span>
          {{ onlineCount }}
        </span>
        <button
          type="button"
          class="expand"
          :disabled="!ready"
          :aria-label="t('overview.enlarge')"
          @click="enlarged = true"
        >
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
    <div class="overview-canvas">
      <canvas
        ref="canvasEl"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      ></canvas>
    </div>
  </aside>

  <OverviewModal v-if="enlarged" @close="enlarged = false" />
</template>

<style scoped>
/* Last cap: the room the right rail has left once the topbar, its own insets, a
   readable contributors list and this panel's own chrome are taken out, converted to a
   width through the map's aspect. Same reasoning as the reference panel, so a
   short window shrinks the map instead of pushing it off the screen. */
.overview {
  position: static;
  width: min(248px, var(--hud-rail-max), calc((100dvh - 300px) * var(--ar)));
  padding: 10px 10px 12px;
}
.overview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding: 0 4px;
}
.overview-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.online-count {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--ink-2);
}
.online-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #34a853;
  flex: none;
}
.overview-canvas {
  position: relative;
  width: 100%;
  aspect-ratio: var(--ar);
  border-radius: 8px;
  overflow: hidden;
  background: #e9e3d3;
  border: 1px solid var(--line-2);
}
.overview-canvas canvas {
  display: block;
  width: 100%;
  height: 100%;
  /* Plain arrow rather than a grab hand: the press aims the camera at a point
     instead of picking the map up, and the arrow's tip is what aims it. */
  cursor: default;
  touch-action: none;
}
.expand {
  flex: none;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  background: none;
  border-radius: var(--radius-btn);
  cursor: pointer;
}
.expand:hover:not(:disabled) {
  background: var(--paper-2);
}
.expand:disabled {
  cursor: default;
  opacity: 0.5;
}
.expand svg {
  width: 13px;
  height: 13px;
  display: block;
}

/* The rail is down to this panel alone here, so the height budget drops to the
   topbar, the tighter insets and this panel's own chrome. */
@media (max-width: 680px), (max-height: 480px) {
  .overview {
    width: min(152px, calc(50vw - 20px), calc((100dvh - 120px) * var(--ar)));
    padding: 8px 8px 9px;
  }
}
</style>
