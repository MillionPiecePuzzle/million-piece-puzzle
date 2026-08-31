<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import OpenSeadragon from "openseadragon";
import type { ImageManifest } from "@mpp/shared";
import { manifestBaseUrl, manifestUrlFor } from "../data/manifestUrl";

// The reference photo as a viewer you can aim at: the enlarged reference window
// and the bookmark badge picker are the same OpenSeadragon deep-zoom viewer over
// the same pyramid, and it is held here once rather than configured twice. Every
// option below is a property of that pyramid and of the page it shares (the pan
// bounds, the zoom floor, the drawer, the CORS policy), none of them of either
// caller.
const props = withDefaults(defineProps<{ manifest: ImageManifest; aiming?: boolean }>(), {
  aiming: false,
});
// A point of the source image (its own pixels), which the caller reads in the
// frame it cares about: the world for a camera jump, the pyramid's tile grid for
// a badge.
const emit = defineEmits<{ pick: [{ x: number; y: number }] }>();

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

// The home fit is already inset by the margins, and minZoomImageRatio pins the
// zoom floor to it, so this is both the rest position and the zoom-out limit.
function fit(immediate = false): void {
  viewer?.viewport.goHome(immediate);
}

// Empty viewer kept on every side of the image, as a fraction of the viewer's own
// size. It is the viewport's margin rather than a zoom-out overshoot, so it is
// there at every zoom: a pan stops with the band showing past the image edge
// instead of running that edge flush against the window, where there is nothing
// left to read it against.
const EDGE_BAND = 0.05;

function applyEdgeBand(): void {
  const el = host.value;
  if (!viewer || !el) return;
  const x = el.clientWidth * EDGE_BAND;
  const y = el.clientHeight * EDGE_BAND;
  viewer.viewport.setMargins({ left: x, right: x, top: y, bottom: y });
}

// A click on the photo hands its point back instead of zooming the viewer, and
// leaves everything else alone, so the window stays there to aim from again
// rather than costing a reopen per pick. Ctrl (or Cmd) arms the same gesture
// while the caller's own toggle is off.
function onCanvasClick(event: OpenSeadragon.CanvasClickEvent): void {
  const mouse = event.originalEvent as MouseEvent;
  if (!event.quick || !(props.aiming || mouse.ctrlKey || mouse.metaKey)) return;
  // Set before the lookup can fail: an aimed click never falls through to the
  // viewer's own click-to-zoom.
  event.preventDefaultAction = true;
  const vp = viewer?.viewport;
  if (!vp) return;
  const image = vp.viewerElementToImageCoordinates(event.position);
  emit("pick", { x: image.x, y: image.y });
}

onMounted(() => {
  if (!host.value) return;
  viewer = OpenSeadragon({
    element: host.value,
    showNavigationControl: false,
    // The whole margin-inset viewport must stay covered by the image, which is
    // what turns the margins into a hard pan limit rather than a home framing.
    visibilityRatio: 1,
    // Keep the image fitted inside the window and snap to that fit the moment it
    // loads, so the reference always opens centered.
    homeFillsViewer: false,
    // Snappier than the default spring: constrain panning to the image bounds
    // (no overscroll bounce) and stiffen the motion so the drag has only a
    // small glide left.
    constrainDuringPan: true,
    animationTime: 0.4,
    springStiffness: 10,
    // The margins already hold the image off the window edges, so the zoom floor
    // is the fitted view itself rather than a further step out of it.
    minZoomImageRatio: 1,
    maxZoomPixelRatio: 2,
    // Context2d drawer rather than the default WebGL one: the page already runs
    // the PixiJS stage's WebGL context, and the webgl drawer's tile texture
    // uploads fail (blank viewer) under that contention.
    drawer: "canvas",
    // CORS on every tile request, though nothing here reads a pixel back. The
    // board streams this same pyramid, at the same URLs (dziRevealLayer.ts),
    // through `fetch`, which WebGL leaves no choice but to make a CORS request.
    // R2 answers a request carrying no Origin with no
    // Access-Control-Allow-Origin and, decisively, no Vary: Origin, so the
    // browser replays that cached response to the board's CORS fetch for the
    // whole max-age: one plain <img> here and the board cannot load that tile
    // for hours, falling back to its blurry base level over the area the
    // player just examined.
    crossOriginPolicy: "Anonymous",
  });
  applyEdgeBand();
  viewer.addHandler("resize", applyEdgeBand);
  viewer.addHandler("open", () => fit(true));
  viewer.addHandler("canvas-click", onCanvasClick);
  viewer.open(dziUrlFor(props.manifest) as unknown as OpenSeadragon.TileSourceSpecifier);
});

watch(
  () => props.manifest.puzzleId,
  () => {
    viewer?.open(dziUrlFor(props.manifest) as unknown as OpenSeadragon.TileSourceSpecifier);
  },
);

onBeforeUnmount(() => {
  viewer?.destroy();
  viewer = null;
});

defineExpose({ fit, zoomBy });
</script>

<template>
  <div ref="host" class="osd" :class="{ aiming }" />
</template>

<style scoped>
.osd {
  width: 100%;
  height: 100%;
}
.osd.aiming {
  /* Inherited by the viewer's own elements, which set no cursor of their own. */
  cursor: crosshair;
}
</style>
