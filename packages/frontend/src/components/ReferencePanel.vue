<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import OpenSeadragon from "openseadragon";
import { useI18n } from "vue-i18n";
import type { ImageManifest } from "@mpp/shared";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { manifestBaseUrl, manifestUrlFor } from "../data/manifestUrl";
import ReferenceModal from "./ReferenceModal.vue";

const { t } = useI18n();
const { state } = usePuzzleSession();

const host = ref<HTMLDivElement | null>(null);
// Drives both the thumbnail's shape and the panel's own width cap, so it has to
// be a bare number the stylesheet can multiply a height budget by.
const aspect = ref(16 / 9);
const showModal = ref(false);

const currentManifest = computed(() =>
  state.value.kind === "ready" || state.value.kind === "syncing" ? state.value.manifest : null,
);

function openModal(): void {
  if (currentManifest.value) showModal.value = true;
}

let viewer: OpenSeadragon.Viewer | null = null;
let openedPuzzleId: string | null = null;

function showReference(manifest: ImageManifest): void {
  if (!viewer || manifest.puzzleId === openedPuzzleId) return;
  openedPuzzleId = manifest.puzzleId;
  aspect.value = manifest.source.width / manifest.source.height;
  const base = manifestBaseUrl(manifestUrlFor(manifest.puzzleId));
  const dziUrl = base + manifest.source.dzi;
  viewer.open(dziUrl as unknown as OpenSeadragon.TileSourceSpecifier);
}

onMounted(() => {
  if (!host.value) return;
  viewer = OpenSeadragon({
    element: host.value,
    showNavigationControl: false,
    mouseNavEnabled: false,
    visibilityRatio: 1,
    minZoomImageRatio: 1,
    maxZoomPixelRatio: 2,
    // Context2d drawer rather than the default WebGL one: this static thumbnail
    // shares the page with the PixiJS stage's WebGL context, and the webgl
    // drawer's tile texture uploads fail (blank panel) under that contention.
    drawer: "canvas",
  });
  watch(
    state,
    (s) => {
      if (s.kind === "ready" || s.kind === "syncing") showReference(s.manifest);
    },
    { immediate: true },
  );
});

onBeforeUnmount(() => {
  viewer?.destroy();
  viewer = null;
});
</script>

<template>
  <aside class="panel reference" :style="{ '--ar': aspect }">
    <h3>{{ t("reference.title") }}</h3>
    <div class="preview">
      <div ref="host" class="osd" />
      <button
        type="button"
        class="open"
        :disabled="!currentManifest"
        :aria-label="t('reference.openEnlarged')"
        @click="openModal"
      >
        <span class="expand" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
        </span>
      </button>
    </div>

    <!-- Inside the panel rather than beside it: the modal teleports to the body
         either way, and a single root is what lets the rail set a class on this
         component at all. -->
    <ReferenceModal
      v-if="showModal && currentManifest"
      :manifest="currentManifest"
      @close="showModal = false"
    />
  </aside>
</template>

<style scoped>
/* Three caps, and the last one is what keeps a tall reference image (or a short
   window) from letting this panel eat its rail: the room the left rail has left
   once the topbar, its own insets, the zoom pillar, a readable activity list and
   this panel's own chrome are taken out, converted to a width through the image
   aspect. Shrinking the whole panel keeps the thumbnail exactly the shape of
   the photo, where clamping its height alone would letterbox it. */
.reference {
  width: min(280px, var(--hud-rail-max), calc((100dvh - 440px) * var(--ar)));
  padding: 12px 14px;
}
.reference h3 {
  margin-bottom: 8px;
}
.preview {
  position: relative;
}
.osd {
  position: relative;
  width: 100%;
  aspect-ratio: var(--ar);
  overflow: hidden;
  border-radius: var(--radius-row);
  background: var(--ground-2);
}
/* Transparent click target laid over the viewer. The OSD host is kept a sibling
   of the button rather than its child: nesting the viewer inside a <button>
   leaves its canvas blank (a button is not a normal containing block for the
   drawer's canvas). */
.open {
  position: absolute;
  inset: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
.open:disabled {
  cursor: default;
}
.expand {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  background: rgba(255, 255, 255, 0.92);
  border-radius: var(--radius-btn);
  box-shadow: var(--shadow-panel);
  opacity: 0;
  transition: opacity 120ms ease;
}
.expand svg {
  width: 14px;
  height: 14px;
  display: block;
}
.open:hover:not(:disabled) .expand,
.open:focus-visible .expand {
  opacity: 1;
}

/* The rail is down to this panel alone here, so the height budget drops to the
   topbar, the tighter insets and this panel's own chrome. */
@media (max-width: 680px), (max-height: 480px) {
  .reference {
    width: min(152px, calc(50vw - 20px), calc((100dvh - 120px) * var(--ar)));
    padding: 8px 9px;
  }
}
</style>
