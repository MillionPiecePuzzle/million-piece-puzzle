<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useMinimap } from "../composables/useMinimap";

const { source } = useMinimap();
const canvasEl = ref<HTMLCanvasElement | null>(null);
const ready = ref(false);
let raf = 0;

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

  // Play zone interior.
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(toX(zone.minX), toY(zone.minY), zoneW * scale, zoneH * scale);

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

  // Pieces, one pixel dot each. Loose first, locked on top so progress reads.
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

onMounted(() => {
  raf = requestAnimationFrame(draw);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
});
</script>

<template>
  <aside v-show="ready" class="panel minimap" aria-label="Minimap">
    <div class="minimap-head">
      <h3>Overview</h3>
    </div>
    <div class="mm-canvas" :style="{ aspectRatio: canvasAspect }">
      <canvas ref="canvasEl"></canvas>
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
}
</style>
