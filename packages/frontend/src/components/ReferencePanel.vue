<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import OpenSeadragon from "openseadragon";
import type { ImageManifest } from "@mpp/shared";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { manifestBaseUrl, manifestUrlFor } from "../data/manifestUrl";

const { state } = usePuzzleSession();

const host = ref<HTMLDivElement | null>(null);
const aspectRatio = ref("16 / 9");

let viewer: OpenSeadragon.Viewer | null = null;
let openedPuzzleId: string | null = null;

function showReference(manifest: ImageManifest): void {
  if (!viewer || manifest.puzzleId === openedPuzzleId) return;
  openedPuzzleId = manifest.puzzleId;
  aspectRatio.value = `${manifest.source.width} / ${manifest.source.height}`;
  const base = manifestBaseUrl(manifestUrlFor(manifest.puzzleId));
  const dziUrl = base + manifest.source.dzi;
  viewer.open(dziUrl as unknown as OpenSeadragon.TileSourceSpecifier);
}

onMounted(() => {
  if (!host.value) return;
  viewer = OpenSeadragon({
    element: host.value,
    showNavigationControl: false,
    visibilityRatio: 1,
    minZoomImageRatio: 1,
    maxZoomPixelRatio: 2,
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
  <aside class="panel reference">
    <h3>Reference</h3>
    <div ref="host" class="osd" :style="{ aspectRatio }" />
  </aside>
</template>

<style scoped>
.reference {
  top: 16px;
  left: 16px;
  width: 280px;
  padding: 12px 14px;
}
.reference h3 {
  margin-bottom: 8px;
}
.osd {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: var(--radius-row);
  background: var(--ground-2);
}
</style>
