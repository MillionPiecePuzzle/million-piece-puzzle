<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { packCell } from "../canvas/groupGrid";
import { paintDensityGrid } from "../canvas/minimapDensity";
import type { PlayZone } from "@mpp/shared";
import type { TileState } from "../canvas/reconcile";
import { useMinimap } from "../composables/useMinimap";
import { useRafLoop } from "../composables/useRafLoop";
import { useLocaleFormat } from "../i18n/format";

const { t } = useI18n();
const { formatNumber } = useLocaleFormat();
const emit = defineEmits<{ close: [] }>();
const { source, detailSource, unpinAll, togglePin } = useMinimap();

const canvasEl = ref<HTMLCanvasElement | null>(null);
const memoryLabel = ref("");
const tilesLabel = ref("");
const pinnedLabel = ref("");
const pinnedCount = ref(0);
const dragging = ref(false);

// The tile scan is cheap but still a whole-zone walk; polling it at animation-
// frame rate would be wasted work for a diagnostic view, so it is throttled to a
// few times a second instead of every rAF.
const POLL_EVERY_N_FRAMES = 15;

function formatBytes(bytes: number): string {
  return `${formatNumber(Math.round(bytes / 1e6))} MB`;
}

// Not-loaded cells paint no wash at all, so the density layer underneath reads
// clearly there: that is exactly the "dense but not loaded" signal a player
// would look for before deciding what to pin.
function washForState(state: TileState): string | null {
  switch (state) {
    case "loaded":
      return "rgba(111,156,106,0.55)";
    case "loading":
      return "rgba(213,135,90,0.55)";
    default:
      return null;
  }
}
// Same accent used for the camera frustum stroke in MiniMap.vue.
const PIN_STROKE = "rgb(213,135,90)";

// Local pan/zoom over the whole-zone view, independent of the main camera:
// this is a diagnostic overview, not a second way to move the player's
// viewport. zoom is a multiplier over the "whole zone fits" scale (zoom 1,
// today's fixed framing); cx/cy is the world point centered in the canvas.
// Plain (non-reactive) state, same idiom as MiniMap.vue's `transform`: nothing
// in the template reads it, only the rAF-driven draw() and pointer handlers.
type View = { zoom: number; cx: number; cy: number };
let view: View | null = null;
const MIN_ZOOM = 1;
const MAX_ZOOM = 16;

function clampView(v: View, zone: PlayZone, zoneW: number, zoneH: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom));
  const halfW = zoneW / zoom / 2;
  const halfH = zoneH / zoom / 2;
  return {
    zoom,
    cx: clampCenter(v.cx, zone.minX, zone.maxX, halfW),
    cy: clampCenter(v.cy, zone.minY, zone.maxY, halfH),
  };
}

// Centers on the zone when the visible window is at least as large as it
// (nothing to clamp against), otherwise keeps the window inside the zone.
// Same pattern as PuzzleStage's private fitOrClamp/clampCamera, reimplemented
// here since that one is private and threaded through Pixi-specific state.
function clampCenter(c: number, lo: number, hi: number, half: number): number {
  const size = hi - lo;
  if (half * 2 >= size) return lo + size / 2;
  return Math.min(hi - half, Math.max(lo + half, c));
}

// Last projection draw() produced, cached so pointer math can invert it
// without recomputing the layout. Same idiom as MiniMap.vue's `transform`.
type Transform = { scale: number; cx: number; cy: number; cw: number; ch: number };
let transform: Transform | null = null;

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

  if (!view) view = { zoom: MIN_ZOOM, cx: zone.minX + zoneW / 2, cy: zone.minY + zoneH / 2 };
  view = clampView(view, zone, zoneW, zoneH);

  const dpr = window.devicePixelRatio || 1;
  const cw = Math.round(canvas.clientWidth * dpr);
  const ch = Math.round(canvas.clientHeight * dpr);
  if (cw === 0 || ch === 0) return;
  if (canvas.width !== cw) canvas.width = cw;
  if (canvas.height !== ch) canvas.height = ch;

  ctx.fillStyle = "#e9e3d3";
  ctx.fillRect(0, 0, cw, ch);

  const fitScale = Math.min(cw / zoneW, ch / zoneH);
  const scale = fitScale * view.zoom;
  const toX = (wx: number): number => cw / 2 + (wx - view!.cx) * scale;
  const toY = (wy: number): number => ch / 2 + (wy - view!.cy) * scale;
  transform = { scale, cx: view.cx, cy: view.cy, cw, ch };

  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(toX(zone.minX), toY(zone.minY), zoneW * scale, zoneH * scale);

  // Density first so the tile-state layer (below) can wash translucently over
  // it instead of hiding it under an opaque fill.
  paintDensityGrid(ctx, snap, toX, toY, scale);

  const cellPx = detail.tiles.cellWorld * scale + 1;
  const pinLineWidth = Math.max(1, 1.5 * dpr);
  let loaded = 0;
  for (const cell of detail.tiles.cells) {
    const x = toX(cell.cx * detail.tiles.cellWorld);
    const y = toY(cell.cy * detail.tiles.cellWorld);
    const wash = washForState(cell.state);
    if (wash) {
      ctx.fillStyle = wash;
      ctx.fillRect(x, y, cellPx, cellPx);
    }
    if (cell.pinned) {
      ctx.strokeStyle = PIN_STROKE;
      ctx.lineWidth = pinLineWidth;
      ctx.strokeRect(
        x + pinLineWidth / 2,
        y + pinLineWidth / 2,
        cellPx - pinLineWidth,
        cellPx - pinLineWidth,
      );
    }
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

// Inverts the cached projection: pointer (CSS px relative to the canvas) ->
// device px -> world. Same idiom as MiniMap.vue's pointerToWorld. Takes a
// plain MouseEvent (both PointerEvent and WheelEvent extend it) since only
// clientX/clientY are needed.
function pointerToWorld(ev: MouseEvent): { x: number; y: number } | null {
  const canvas = canvasEl.value;
  if (!canvas || !transform) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const px = (ev.clientX - rect.left) * (canvas.width / rect.width);
  const py = (ev.clientY - rect.top) * (canvas.height / rect.height);
  const t = transform;
  return {
    x: (px - t.cw / 2) / t.scale + t.cx,
    y: (py - t.ch / 2) / t.scale + t.cy,
  };
}

function onWheel(ev: WheelEvent): void {
  const zone = source.value?.()?.playZone ?? null;
  if (!view || !zone) return;
  const world = pointerToWorld(ev);
  if (!world) return;
  // Keeps the world point under the cursor fixed across the zoom step, same
  // approach as PuzzleStage's attachWheelZoom/zoomBy.
  const factor = Math.exp(-ev.deltaY * 0.0015);
  const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  const k = nextZoom / view.zoom;
  view = clampView(
    {
      zoom: nextZoom,
      cx: world.x - (world.x - view.cx) / k,
      cy: world.y - (world.y - view.cy) / k,
    },
    zone,
    zone.maxX - zone.minX,
    zone.maxY - zone.minY,
  );
}

// A short movement threshold tells a pan-drag apart from a click: a click (no
// drag) toggles the pin on the cell under the pointer.
const DRAG_THRESHOLD_PX = 4;
let pointerStart: { x: number; y: number } | null = null;
let lastPointer: { x: number; y: number } | null = null;

function onPointerDown(ev: PointerEvent): void {
  if (ev.button !== 0) return;
  canvasEl.value?.setPointerCapture(ev.pointerId);
  pointerStart = { x: ev.clientX, y: ev.clientY };
  lastPointer = pointerStart;
  dragging.value = false;
}

function onPointerMove(ev: PointerEvent): void {
  if (!pointerStart || !lastPointer || !view || !transform) return;
  if (!dragging.value) {
    const dx = ev.clientX - pointerStart.x;
    const dy = ev.clientY - pointerStart.y;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    dragging.value = true;
  }
  const canvas = canvasEl.value;
  const zone = source.value?.()?.playZone ?? null;
  if (!canvas || !zone) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  const devicePxPerCssPx = canvas.width / rect.width;
  const dx = (ev.clientX - lastPointer.x) * devicePxPerCssPx;
  const dy = (ev.clientY - lastPointer.y) * devicePxPerCssPx;
  lastPointer = { x: ev.clientX, y: ev.clientY };
  view = clampView(
    { zoom: view.zoom, cx: view.cx - dx / transform.scale, cy: view.cy - dy / transform.scale },
    zone,
    zone.maxX - zone.minX,
    zone.maxY - zone.minY,
  );
}

function onPointerUp(ev: PointerEvent): void {
  canvasEl.value?.releasePointerCapture(ev.pointerId);
  if (pointerStart && !dragging.value) togglePinAt(ev);
  pointerStart = null;
  lastPointer = null;
  dragging.value = false;
}

function togglePinAt(ev: PointerEvent): void {
  const detail = detailSource.value?.() ?? null;
  const zone = source.value?.()?.playZone ?? null;
  const world = pointerToWorld(ev);
  if (!detail || !zone || !world) return;
  // A click can land in the letterbox margin around the zone (the canvas box's
  // aspect rarely matches the zone's exactly); ignore it rather than pinning
  // whatever cell coordinates fall outside the actual play zone.
  if (world.x < zone.minX || world.x > zone.maxX || world.y < zone.minY || world.y > zone.maxY) {
    return;
  }
  const cellWorld = detail.tiles.cellWorld;
  const key = packCell(Math.floor(world.x / cellWorld), Math.floor(world.y / cellWorld));
  togglePin.value?.(key);
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
    <div class="shell" role="dialog" aria-modal="true" :aria-label="t('minimap.detailTitle')">
      <button type="button" class="close" :aria-label="t('common.close')" @click="emit('close')">
        &times;
      </button>
      <h3 class="title">{{ t("minimap.detailTitle") }}</h3>
      <p class="hint">{{ t("minimap.pinHint") }}</p>
      <div class="grid-wrap">
        <canvas
          ref="canvasEl"
          :class="{ dragging }"
          @wheel.prevent="onWheel"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        ></canvas>
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
.hint {
  margin: -6px 0 0;
  font-size: 12px;
  color: var(--ink-3);
}
.grid-wrap {
  position: relative;
  width: 100%;
  height: min(55vh, 560px);
  border-radius: 8px;
  overflow: hidden;
  background: #e9e3d3;
  border: 1px solid var(--line-2);
}
.grid-wrap canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: pointer;
  touch-action: none;
}
.grid-wrap canvas.dragging {
  cursor: grabbing;
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
