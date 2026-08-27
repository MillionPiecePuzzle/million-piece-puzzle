<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import OpenSeadragon from "openseadragon";
import { useI18n } from "vue-i18n";
import type { ImageManifest } from "@mpp/shared";
import { manifestBaseUrl, manifestUrlFor } from "../data/manifestUrl";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useBackdropClick } from "../composables/useBackdropClick";

const { t } = useI18n();
const props = defineProps<{ manifest: ImageManifest }>();
const emit = defineEmits<{ close: [] }>();

const host = ref<HTMLDivElement | null>(null);
const shellEl = ref<HTMLElement | null>(null);
const trap = useFocusTrap(shellEl, { onEscape: () => emit("close") });
const { onMousedown, onClick } = useBackdropClick(() => emit("close"));
let viewer: OpenSeadragon.Viewer | null = null;

const aspectRatio = computed(() => `${props.manifest.source.width / props.manifest.source.height}`);

function dziUrlFor(manifest: ImageManifest): string {
  return manifestBaseUrl(manifestUrlFor(manifest.puzzleId)) + manifest.source.dzi;
}

function zoomBy(factor: number): void {
  const vp = viewer?.viewport;
  if (!vp) return;
  vp.zoomBy(factor);
  vp.applyConstraints();
}

// Rest at the maximum zoom-out (minZoomImageRatio below) so the image sits
// inside the viewer with a visible border all around, rather than filling it.
function fit(immediate = false): void {
  const vp = viewer?.viewport;
  if (!vp) return;
  vp.goHome(true);
  vp.zoomTo(vp.getMinZoom(), undefined, immediate);
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
  viewer.addHandler("open", () => fit(true));
  viewer.open(dziUrlFor(props.manifest) as unknown as OpenSeadragon.TileSourceSpecifier);
  trap.activate();
});

onBeforeUnmount(() => {
  viewer?.destroy();
  viewer = null;
});
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @mousedown="onMousedown" @click="onClick">
      <div
        ref="shellEl"
        class="shell"
        role="dialog"
        aria-modal="true"
        :aria-label="t('reference.image')"
        :style="{ '--ar': aspectRatio }"
      >
        <button type="button" class="close" :aria-label="t('common.close')" @click="emit('close')">
          &times;
        </button>
        <div ref="host" class="osd-large" />
        <div class="zoom">
          <button type="button" :aria-label="t('zoom.in')" @click="zoomBy(1.4)">
            <svg class="ic" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 3v10M3 8h10"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
          </button>
          <button type="button" :aria-label="t('zoom.out')" @click="zoomBy(1 / 1.4)">
            <svg class="ic" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            </svg>
          </button>
          <button type="button" :aria-label="t('reference.fitToView')" @click="fit()">
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
        <RouterLink
          to="/legal#credits"
          class="caption"
          :title="t('reference.credits')"
          target="_blank"
          rel="noopener"
        >
          {{ manifest.name }}
        </RouterLink>
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
  /* One uniform value on all four sides, so the gap around the window is equal
     left/right and top/bottom. The top adds the 52px TopBar height instead of
     insetting the backdrop: the overlay covers the whole viewport, so nothing
     behind it stays clickable, while the window still centers in the play
     zone below the bar. */
  padding: clamp(24px, 5vmin, 56px);
  padding-top: calc(52px + clamp(24px, 5vmin, 56px));
  /* Room for the caption, which hangs below the shell rather than inside it. */
  padding-bottom: calc(10px + clamp(24px, 5vmin, 56px));
  background: rgba(21, 20, 15, 0.6);
  backdrop-filter: blur(2px);
  /* Size container so the shell can compute the largest image-ratio box that
     fits the padded play zone, using cqw/cqh below. */
  container-type: size;
}
.shell {
  position: relative;
  /* Hug the reference image: the largest box at the image aspect ratio that
     fits both the available width and height, so there are no empty side bands. */
  aspect-ratio: var(--ar);
  width: min(100cqw, calc(100cqh * var(--ar)));
  height: auto;
  max-width: 100%;
  max-height: 100%;
  /* No overflow clip here: the caption is anchored just below the shell and must
     escape it. The image clip lives on .osd-large instead. */
}
.osd-large {
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--ground-2);
  box-shadow: var(--shadow-panel);
}
.caption {
  position: absolute;
  top: calc(100% + 9px);
  left: 2px;
  max-width: 100%;
  margin: 0;
  font-family: var(--serif);
  font-size: 14px;
  line-height: 1.2;
  color: var(--ground);
  text-decoration: none;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.caption:hover,
.caption:focus-visible {
  text-decoration: underline;
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
