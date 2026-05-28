<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import OpenSeadragon from "openseadragon";
import type { ImageManifest } from "@mpp/shared";
import { manifestBaseUrl, manifestUrlFor } from "../data/manifestUrl";

const props = defineProps<{ manifest: ImageManifest }>();
const emit = defineEmits<{ close: [] }>();

const host = ref<HTMLDivElement | null>(null);
let viewer: OpenSeadragon.Viewer | null = null;

function dziUrlFor(manifest: ImageManifest): string {
  return manifestBaseUrl(manifestUrlFor(manifest.puzzleId)) + manifest.source.dzi;
}

function zoomBy(factor: number): void {
  const vp = viewer?.viewport;
  if (!vp) return;
  vp.zoomBy(factor);
  vp.applyConstraints();
}

function fit(): void {
  viewer?.viewport?.goHome();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") emit("close");
}

onMounted(() => {
  if (!host.value) return;
  viewer = OpenSeadragon({
    element: host.value,
    showNavigationControl: false,
    visibilityRatio: 1,
    // Keep the image fitted inside the modal and snap to that fit the moment it
    // loads, so the reference always opens centered.
    homeFillsViewer: false,
    // Snappier than the default spring: constrain panning to the image bounds
    // (no overscroll bounce) and stiffen the motion so the drag has only a
    // small glide left.
    constrainDuringPan: true,
    animationTime: 0.4,
    springStiffness: 10,
    minZoomImageRatio: 0.9,
    maxZoomPixelRatio: 2,
    // Context2d drawer rather than the default WebGL one: the page already runs
    // the PixiJS stage's WebGL context, and the webgl drawer's tile texture
    // uploads fail (blank viewer) under that contention.
    drawer: "canvas",
  });
  viewer.addHandler("open", () => viewer?.viewport.goHome(true));
  viewer.open(dziUrlFor(props.manifest) as unknown as OpenSeadragon.TileSourceSpecifier);
  window.addEventListener("keydown", onKey);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  viewer?.destroy();
  viewer = null;
});
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="shell" role="dialog" aria-modal="true" aria-label="Reference image">
      <button type="button" class="close" aria-label="Close" @click="emit('close')">&times;</button>
      <div ref="host" class="osd-large" />
      <div class="zoom">
        <button type="button" aria-label="Zoom in" @click="zoomBy(1.4)">
          <svg class="ic" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 3v10M3 8h10"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <button type="button" aria-label="Zoom out" @click="zoomBy(1 / 1.4)">
          <svg class="ic" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
        <button type="button" aria-label="Fit to view" @click="fit">
          <svg class="ic" viewBox="0 0 16 16" fill="none">
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
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  /* Cover the play zone only (below the 52px TopBar), so the window centers in
     the play area rather than the whole viewport. */
  inset: 52px 0 0 0;
  z-index: 60;
  display: grid;
  place-items: center;
  /* One uniform value on all four sides, so the gap around the window is equal
     left/right and top/bottom. */
  padding: clamp(24px, 5vmin, 56px);
  background: rgba(21, 20, 15, 0.6);
  backdrop-filter: blur(2px);
}
.shell {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--ground-2);
  box-shadow: var(--shadow-panel);
}
.osd-large {
  width: 100%;
  height: 100%;
}
.close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  font-size: 22px;
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
.zoom {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  border: 1px solid var(--line);
  border-radius: 12px;
}
.zoom button {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  border-bottom: 1px solid var(--line-2);
}
.zoom button:last-child {
  border-bottom: none;
}
.zoom button:hover {
  background: var(--paper-2);
}
.ic {
  width: 16px;
  height: 16px;
  display: block;
}
</style>
