<script setup lang="ts">
import { computed } from "vue";
import TopBar from "../components/TopBar.vue";
import PuzzleCanvas from "../components/PuzzleCanvas.vue";
import ZoomControls from "../components/ZoomControls.vue";
import LeaderboardPanel from "../components/LeaderboardPanel.vue";
import ActivityTicker from "../components/ActivityTicker.vue";
import { useStageControls } from "../composables/useStageControls";

// Anchor the hairline grid to world space: one cell is a fixed world distance,
// so it scales and pans with the canvas and reads as a measuring scale.
const GRID_WORLD_CELL = 80;

const { camera } = useStageControls();

const backdropVars = computed(() => ({
  "--grid-cell": `${GRID_WORLD_CELL * camera.value.zoom}px`,
  "--grid-x": `${camera.value.x}px`,
  "--grid-y": `${camera.value.y}px`,
}));
</script>

<template>
  <div class="play">
    <TopBar />
    <main class="stage" aria-label="Puzzle stage" :style="backdropVars">
      <PuzzleCanvas />
      <ZoomControls />
      <LeaderboardPanel />
      <ActivityTicker />
    </main>
  </div>
</template>

<style scoped>
.play {
  height: 100%;
}
.stage {
  position: fixed;
  inset: 52px 0 0 0;
  overflow: hidden;
  background: radial-gradient(circle at 50% 40%, #faf7f0 0%, #efeadd 70%, #e7e1d1 100%);
}
.stage::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: radial-gradient(rgba(21, 20, 15, 0.035) 1px, transparent 1.2px);
  background-size: 6px 6px;
  mix-blend-mode: multiply;
  opacity: 0.6;
}
.stage::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(21, 20, 15, 0.04) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(21, 20, 15, 0.04) 1px, transparent 1px);
  background-size: var(--grid-cell, 80px) var(--grid-cell, 80px);
  background-position: var(--grid-x, 0) var(--grid-y, 0);
}
</style>
