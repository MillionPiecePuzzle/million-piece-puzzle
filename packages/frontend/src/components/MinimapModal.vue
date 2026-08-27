<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { MIN_OVERVIEW_ASPECT, drawOverview, overviewAspect } from "../canvas/minimapView";
import { useMinimap } from "../composables/useMinimap";
import { useBoardFlags } from "../composables/useBoardFlags";
import { useRafLoop } from "../composables/useRafLoop";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useBackdropClick } from "../composables/useBackdropClick";

const { t } = useI18n();
const emit = defineEmits<{ close: [] }>();
const { source } = useMinimap();
const { flags } = useBoardFlags();

const canvasEl = ref<HTMLCanvasElement | null>(null);
const shellEl = ref<HTMLElement | null>(null);
const trap = useFocusTrap(shellEl, { onEscape: () => emit("close") });
const { onMousedown, onClick } = useBackdropClick(() => emit("close"));

const shellAspect = ref(MIN_OVERVIEW_ASPECT);

// The minimap panel's own map at a size that can be read rather than only aimed
// at. Same painter, same per-frame cadence, so the frustum, the flags and the
// piece dots track the board here exactly as they do in the panel. Nothing here
// takes a pointer: the panel stays the one place a press moves the camera.
function draw(): void {
  const snap = source.value?.() ?? null;
  if (!snap) return;
  const aspect = overviewAspect(snap);
  if (aspect === null) return;
  shellAspect.value = aspect;
  const canvas = canvasEl.value;
  if (!canvas) return;
  drawOverview(canvas, snap, flags.value);
}

useRafLoop(draw);

onMounted(trap.activate);
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @mousedown="onMousedown" @click="onClick">
      <div
        ref="shellEl"
        class="shell"
        role="dialog"
        aria-modal="true"
        :aria-label="t('minimap.overview')"
        :style="{ '--ar': shellAspect }"
      >
        <button type="button" class="close" :aria-label="t('common.close')" @click="emit('close')">
          &times;
        </button>
        <h3 class="title">{{ t("minimap.overview") }}</h3>
        <div class="map-wrap">
          <canvas ref="canvasEl"></canvas>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  /* Extra top padding for the 52px TopBar, matching ReferenceModal: the overlay
     covers the whole viewport while the window centers in the play zone. */
  padding: clamp(24px, 5vmin, 56px);
  padding-top: calc(52px + clamp(24px, 5vmin, 56px));
  background: rgba(21, 20, 15, 0.6);
  backdrop-filter: blur(2px);
}
.shell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* Width the map fits in on both axes: the last term is the widest a map of
     this aspect can be while its height still clears the modal's own chrome and
     the backdrop padding, so a short window (a phone held sideways) shrinks the
     map instead of running it off the screen. No lower bound, since any floor
     above that term is exactly what would push it off again. */
  width: min(100%, 880px, calc((100dvh - 200px) * var(--ar)));
  padding: 16px 18px 14px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-panel);
}
.title {
  padding-right: 28px;
}
.map-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: var(--ar);
  border-radius: 8px;
  overflow: hidden;
  background: #e9e3d3;
  border: 1px solid var(--line-2);
}
.map-wrap canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  font-size: 20px;
  line-height: 1;
  color: var(--ink-2);
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid var(--line);
  border-radius: 50%;
  box-shadow: var(--shadow-panel);
}
.close:hover {
  color: var(--ink);
}
</style>
