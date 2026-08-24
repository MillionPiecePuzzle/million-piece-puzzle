<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { FLAG_COLORS, FLAG_COLOR_KEYS } from "../data/boardFlags";
import { useBoardFlags } from "../composables/useBoardFlags";
import { useStageControls } from "../composables/useStageControls";
import { pushEscapeHandler } from "../escapeStack";

const { t } = useI18n();
const { camera } = useStageControls();
const { flags, selected, recolor, remove, select } = useBoardFlags();

const host = ref<HTMLElement | null>(null);
const hostSize = ref({ w: 0, h: 0 });
const popEl = ref<HTMLElement | null>(null);
let releaseEscape: (() => void) | null = null;

// Fixed so the edge clamp below needs no measurement of the popover itself.
const POP_WIDTH = 214;
const EDGE_GAP = 10;
// Clear of the canvas glyph, which draws upward from the point it marks.
const GLYPH_HEIGHT = 38;

const slot = computed(() => {
  const flag = selected.value;
  if (!flag) return 0;
  return flags.value.findIndex((f) => f.id === flag.id) + 1;
});

const anchor = computed(() => {
  const flag = selected.value;
  if (!flag) return null;
  const cam = camera.value;
  return { x: flag.worldX * cam.zoom + cam.x, y: flag.worldY * cam.zoom + cam.y };
});

// A flag panned off the board takes its popover with it rather than leaving it
// pinned to an edge with nothing under it.
const onScreen = computed(() => {
  const point = anchor.value;
  const size = hostSize.value;
  if (!point || size.w === 0) return false;
  return point.x >= 0 && point.x <= size.w && point.y >= 0 && point.y <= size.h;
});

const style = computed(() => {
  const point = anchor.value;
  if (!point) return undefined;
  const half = POP_WIDTH / 2;
  const maxX = Math.max(half + EDGE_GAP, hostSize.value.w - half - EDGE_GAP);
  return {
    left: `${Math.min(Math.max(point.x, half + EDGE_GAP), maxX)}px`,
    top: `${point.y - GLYPH_HEIGHT}px`,
    width: `${POP_WIDTH}px`,
  };
});

function measure(): void {
  const rect = host.value?.getBoundingClientRect();
  if (rect) hostSize.value = { w: rect.width, h: rect.height };
}

function onPointerDown(ev: PointerEvent): void {
  const target = ev.target;
  if (target instanceof Node && popEl.value?.contains(target)) return;
  select(null);
}

watch(
  () => selected.value !== null,
  (open) => {
    if (open) {
      window.addEventListener("pointerdown", onPointerDown, true);
      releaseEscape = pushEscapeHandler(() => select(null));
      return;
    }
    window.removeEventListener("pointerdown", onPointerDown, true);
    releaseEscape?.();
    releaseEscape = null;
  },
);

onMounted(() => {
  measure();
  window.addEventListener("resize", measure);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", measure);
  window.removeEventListener("pointerdown", onPointerDown, true);
  releaseEscape?.();
});
</script>

<template>
  <div ref="host" class="flag-pop-host">
    <div
      v-if="selected && onScreen"
      ref="popEl"
      class="flag-pop"
      :style="style"
      role="group"
      :aria-label="t('flags.options', { n: slot })"
    >
      <div class="swatches">
        <button
          v-for="(color, i) in FLAG_COLORS"
          :key="color"
          type="button"
          class="swatch"
          :class="{ active: i === selected.color }"
          :style="{ background: color }"
          :aria-label="t(`flags.colors.${FLAG_COLOR_KEYS[i]}`)"
          :aria-pressed="i === selected.color"
          @click="recolor(selected.id, i)"
        />
      </div>
      <button type="button" class="delete" @click="remove(selected.id)">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        {{ t("flags.delete") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.flag-pop-host {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 11;
}
.flag-pop {
  position: absolute;
  transform: translate(-50%, -100%);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(10px);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow-panel);
}
.swatches {
  display: flex;
  gap: 4px;
}
.swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid rgba(21, 20, 15, 0.45);
  cursor: pointer;
}
.swatch:hover {
  transform: scale(1.12);
}
.swatch.active {
  box-shadow:
    0 0 0 2px var(--paper),
    0 0 0 3.5px var(--ink-2);
}
.delete {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: var(--radius-btn);
  border-top: 1px solid var(--line-2);
  font-size: 12px;
  color: var(--ink-2);
  cursor: pointer;
}
.delete:hover {
  background: var(--paper-2);
  color: oklch(0.55 0.18 30);
}
.delete svg {
  width: 13px;
  height: 13px;
}
</style>
