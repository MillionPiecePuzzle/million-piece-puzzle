<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useMinimap } from "../composables/useMinimap";

const { t } = useI18n();
const { source, navigate } = useMinimap();
const canvasEl = ref<HTMLCanvasElement | null>(null);
const ready = ref(false);
const dragging = ref(false);
let raf = 0;

// Last canvas->world mapping the draw loop produced, captured so a pointer press
// can invert it without recomputing the layout. Null until the first real frame.
type MapTransform = {
  scale: number;
  offX: number;
  offY: number;
  zoneMinX: number;
  zoneMinY: number;
  margin: number;
};
let transform: MapTransform | null = null;

// Out-of-bounds band: the play zone is inset by this fraction of its larger
// side so a thin margin of outside space shows on every edge. Matches the
// camera padding ring, so the frustum stays inside the band while panning.
const OUTSIDE_MARGIN_FRACTION = 0.04;
const OUTSIDE_FILL = "#ada99e";

// The canvas takes the shape of the play zone (plus its band) so the map fills
// it with no letterbox. Clamped so a strongly non-square zone cannot make the
// panel absurdly short or tall.
const MIN_CANVAS_ASPECT = 1;
const MAX_CANVAS_ASPECT = 2;
const canvasAspect = ref(MIN_CANVAS_ASPECT);

// Redraws every frame from a fresh stage snapshot: cheap at alpha scale (a few
// thousand fillRects) and keeps the frustum tracking pan and zoom with no
// extra plumbing.
function draw(): void {
  raf = requestAnimationFrame(draw);
  // The minimap stays hidden until the stage has a play zone, so it never
  // shows a placeholder shape that would resize once real data arrives.
  const snap = source.value?.() ?? null;
  ready.value = snap !== null;
  if (!snap) return;

  const zone = snap.playZone;
  const zoneW = zone.maxX - zone.minX;
  const zoneH = zone.maxY - zone.minY;
  if (zoneW <= 0 || zoneH <= 0) return;

  // The canvas is shaped to the play zone plus its out-of-bounds band, so the
  // map fills it with no letterbox; only the thin band shows around the edges.
  // Set before the canvas-size guard so the panel appears at its final shape.
  const margin = Math.max(zoneW, zoneH) * OUTSIDE_MARGIN_FRACTION;
  const mapW = zoneW + margin * 2;
  const mapH = zoneH + margin * 2;
  canvasAspect.value = Math.min(MAX_CANVAS_ASPECT, Math.max(MIN_CANVAS_ASPECT, mapW / mapH));

  const canvas = canvasEl.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cw = Math.round(canvas.clientWidth * dpr);
  const ch = Math.round(canvas.clientHeight * dpr);
  if (cw === 0 || ch === 0) return;
  if (canvas.width !== cw) canvas.width = cw;
  if (canvas.height !== ch) canvas.height = ch;

  // Paint the whole panel with the out-of-bounds tone, so the world outside
  // the play zone reads on every side once the zone is inset within it.
  ctx.fillStyle = OUTSIDE_FILL;
  ctx.fillRect(0, 0, cw, ch);

  const scale = Math.min(cw / mapW, ch / mapH);
  const offX = (cw - mapW * scale) / 2;
  const offY = (ch - mapH * scale) / 2;
  const toX = (wx: number): number => offX + (wx - zone.minX + margin) * scale;
  const toY = (wy: number): number => offY + (wy - zone.minY + margin) * scale;
  transform = { scale, offX, offY, zoneMinX: zone.minX, zoneMinY: zone.minY, margin };

  // Play zone interior.
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(toX(zone.minX), toY(zone.minY), zoneW * scale, zoneH * scale);

  // Server-computed density grid: the global overview, decoupled from the
  // (partial) local board. Loose cells in a light ink, locked cells darker on
  // top, alpha scaled by per-cell count so denser cells read stronger. The local
  // known-region overlay is drawn on top of this afterwards. A +1 px on each cell
  // closes hairline seams between neighbours.
  const grid = snap.grid;
  if (grid && grid.cols > 0 && grid.rows > 0) {
    let maxCount = 1;
    for (let i = 0; i < grid.cols * grid.rows; i++) {
      const t = (grid.loose[i] ?? 0) + (grid.locked[i] ?? 0);
      if (t > maxCount) maxCount = t;
    }
    const cw = grid.cellW * scale + 1;
    const ch = grid.cellH * scale + 1;
    const paint = (counts: number[], base: number, span: number) => {
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          const idx = r * grid.cols + c;
          // Skip cells the live overlay already covers, so a stale server count
          // never shows under a region the client knows fresh.
          if (snap.knownCells.has(idx)) continue;
          const n = counts[idx] ?? 0;
          if (n <= 0) continue;
          const x = toX(grid.originX + c * grid.cellW);
          const y = toY(grid.originY + r * grid.cellH);
          ctx.fillStyle = `rgba(21,20,15,${(base + span * (n / maxCount)).toFixed(3)})`;
          ctx.fillRect(x, y, cw, ch);
        }
      }
    };
    paint(grid.loose, 0.08, 0.32);
    paint(grid.locked, 0.2, 0.55);
  }

  // Puzzle frame.
  const fx = toX(0);
  const fy = toY(0);
  const fw = snap.frame.w * scale;
  const fh = snap.frame.h * scale;
  ctx.fillStyle = "rgba(21,20,15,0.05)";
  ctx.fillRect(fx, fy, fw, fh);
  ctx.strokeStyle = "rgba(21,20,15,0.45)";
  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeRect(fx, fy, fw, fh);

  // Local known-region overlay: one dot per known piece (the visited regions the
  // client has fresh positions for), refining the coarse grid. Loose first,
  // locked on top so progress reads. Empty for a contributor's far-zoomed fit
  // (no regions built yet), where the grid alone carries the overview.
  const dot = Math.max(1, 1.4 * dpr);
  const half = dot / 2;
  ctx.fillStyle = "rgba(21,20,15,0.22)";
  for (const p of snap.pieces) {
    if (!p.locked) ctx.fillRect(toX(p.x) - half, toY(p.y) - half, dot, dot);
  }
  ctx.fillStyle = "rgba(21,20,15,0.62)";
  for (const p of snap.pieces) {
    if (p.locked) ctx.fillRect(toX(p.x) - half, toY(p.y) - half, dot, dot);
  }

  // Camera frustum.
  if (snap.viewport) {
    const v = snap.viewport;
    const x = toX(v.worldX);
    const y = toY(v.worldY);
    const w = v.worldW * scale;
    const h = v.worldH * scale;
    ctx.fillStyle = "rgba(213,135,90,0.14)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgb(213,135,90)";
    ctx.lineWidth = Math.max(1, 1.5 * dpr);
    ctx.strokeRect(x, y, w, h);
  }
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

onMounted(() => {
  raf = requestAnimationFrame(draw);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
});
</script>

<template>
  <aside v-show="ready" class="panel minimap" :aria-label="t('minimap.label')">
    <div class="minimap-head">
      <h3>{{ t("minimap.overview") }}</h3>
    </div>
    <div class="mm-canvas" :style="{ aspectRatio: canvasAspect }">
      <canvas
        ref="canvasEl"
        :class="{ dragging }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      ></canvas>
    </div>
  </aside>
</template>

<style scoped>
.minimap {
  position: static;
  width: 248px;
  padding: 10px 10px 12px;
}
.minimap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding: 0 4px;
}
.mm-canvas {
  position: relative;
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
  background: #e9e3d3;
  border: 1px solid var(--line-2);
}
.mm-canvas canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
}
.mm-canvas canvas.dragging {
  cursor: grabbing;
}
</style>
