<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { TileState } from "../canvas/reconcile";
import { useMinimap } from "../composables/useMinimap";
import { useRafLoop } from "../composables/useRafLoop";
import { useLocaleFormat } from "../i18n/format";

const { t } = useI18n();
const { formatNumber } = useLocaleFormat();
const emit = defineEmits<{ close: [] }>();
const { source, detailSource, unpinAll } = useMinimap();

const canvasEl = ref<HTMLCanvasElement | null>(null);
const memoryLabel = ref("");
const tilesLabel = ref("");
const pinnedLabel = ref("");
const pinnedCount = ref(0);

// Same clamp MiniMap.vue applies to the same play zone, so a strongly non-square
// zone cannot make this grid absurdly wide or tall either.
const MIN_ASPECT = 1;
const MAX_ASPECT = 2;
const shellAspect = ref(MIN_ASPECT);

// The tile scan is cheap but still a whole-zone walk; polling it at animation-
// frame rate would be wasted work for a diagnostic view, so it is throttled to a
// few times a second instead of every rAF.
const POLL_EVERY_N_FRAMES = 15;

function formatBytes(bytes: number): string {
  return `${formatNumber(Math.round(bytes / 1e6))} MB`;
}

function colorForState(state: TileState): string {
  switch (state) {
    case "loaded":
      return "#6f9c6a";
    case "loading":
      return "#d5875a";
    default:
      return "#c9c3b3";
  }
}

function draw(): void {
  const canvas = canvasEl.value;
  const snap = source.value?.() ?? null;
  const detail = detailSource.value?.() ?? null;
  if (!canvas || !snap || !detail) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const zone = snap.playZone;
  const zoneW = zone.maxX - zone.minX;
  const zoneH = zone.maxY - zone.minY;
  if (zoneW <= 0 || zoneH <= 0) return;
  shellAspect.value = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, zoneW / zoneH));

  const dpr = window.devicePixelRatio || 1;
  const cw = Math.round(canvas.clientWidth * dpr);
  const ch = Math.round(canvas.clientHeight * dpr);
  if (cw === 0 || ch === 0) return;
  if (canvas.width !== cw) canvas.width = cw;
  if (canvas.height !== ch) canvas.height = ch;

  ctx.fillStyle = "#e9e3d3";
  ctx.fillRect(0, 0, cw, ch);

  const scale = Math.min(cw / zoneW, ch / zoneH);
  const offX = (cw - zoneW * scale) / 2;
  const offY = (ch - zoneH * scale) / 2;
  const toX = (wx: number): number => offX + (wx - zone.minX) * scale;
  const toY = (wy: number): number => offY + (wy - zone.minY) * scale;

  const cellPx = detail.tiles.cellWorld * scale + 1;
  let loaded = 0;
  for (const cell of detail.tiles.cells) {
    ctx.fillStyle = colorForState(cell.state);
    ctx.fillRect(
      toX(cell.cx * detail.tiles.cellWorld),
      toY(cell.cy * detail.tiles.cellWorld),
      cellPx,
      cellPx,
    );
    if (cell.state === "loaded") loaded++;
  }

  tilesLabel.value = t("minimap.tilesLoaded", {
    loaded: formatNumber(loaded),
    total: formatNumber(detail.tiles.cells.length),
  });
  memoryLabel.value = t("minimap.memoryUsage", {
    used: formatBytes(detail.memory.usedBytes),
    budget: formatBytes(detail.memory.budgetBytes),
  });
  pinnedCount.value = detail.pinnedCount;
  pinnedLabel.value = t("minimap.pinnedCount", {
    pinned: formatNumber(detail.pinnedCount),
    cap: formatNumber(detail.pinCap),
  });
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") emit("close");
}

useRafLoop(draw, POLL_EVERY_N_FRAMES);

onMounted(() => {
  window.addEventListener("keydown", onKey);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div
      class="shell"
      role="dialog"
      aria-modal="true"
      :aria-label="t('minimap.detailTitle')"
      :style="{ '--ar': shellAspect }"
    >
      <button type="button" class="close" :aria-label="t('common.close')" @click="emit('close')">
        &times;
      </button>
      <h3 class="title">{{ t("minimap.detailTitle") }}</h3>
      <div class="grid-wrap">
        <canvas ref="canvasEl"></canvas>
        <div class="readout">
          <div>{{ memoryLabel }}</div>
          <div>{{ tilesLabel }}</div>
          <div>{{ pinnedLabel }}</div>
        </div>
      </div>
      <div class="footer">
        <ul class="legend">
          <li><span class="swatch loaded"></span>{{ t("minimap.legendLoaded") }}</li>
          <li><span class="swatch loading"></span>{{ t("minimap.legendLoading") }}</li>
          <li><span class="swatch not-loaded"></span>{{ t("minimap.legendNotLoaded") }}</li>
        </ul>
        <button type="button" class="unpin-all" :disabled="pinnedCount === 0" @click="unpinAll?.()">
          {{ t("minimap.unpinAll") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  /* Cover the play zone only (below the 52px TopBar), matching ReferenceModal. */
  inset: 52px 0 0 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: clamp(24px, 5vmin, 56px);
  background: rgba(21, 20, 15, 0.6);
  backdrop-filter: blur(2px);
}
.shell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(90vw, 720px);
  padding: 16px 18px 14px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-panel);
}
.title {
  padding-right: 28px;
}
.grid-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: var(--ar);
  border-radius: 8px;
  overflow: hidden;
  background: #e9e3d3;
  border: 1px solid var(--line-2);
}
.grid-wrap canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.readout {
  position: absolute;
  left: 10px;
  bottom: 10px;
  padding: 5px 9px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  line-height: 1.3;
  color: var(--ink-2);
  background: rgba(255, 255, 255, 0.85);
  border-radius: var(--radius-btn);
  box-shadow: var(--shadow-panel);
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  color: var(--ink-2);
}
.unpin-all {
  flex: none;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--ink-3);
  background: transparent;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  cursor: pointer;
  transition:
    background 150ms ease,
    color 150ms ease;
}
.unpin-all:hover:not(:disabled) {
  background: var(--paper-2);
  color: var(--ink);
}
.unpin-all:disabled {
  cursor: default;
  opacity: 0.5;
}
.legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.swatch {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  display: inline-block;
}
.swatch.loaded {
  background: #6f9c6a;
}
.swatch.loading {
  background: #d5875a;
}
.swatch.not-loaded {
  background: #c9c3b3;
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
