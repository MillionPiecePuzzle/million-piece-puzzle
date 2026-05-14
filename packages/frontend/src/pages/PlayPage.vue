<script setup lang="ts">
import TopBar from "../components/TopBar.vue";
import PuzzleCanvas from "../components/PuzzleCanvas.vue";
import ZoomControls from "../components/ZoomControls.vue";
import LeaderboardPanel from "../components/LeaderboardPanel.vue";
import ActivityTicker from "../components/ActivityTicker.vue";
</script>

<template>
  <div class="play">
    <TopBar />
    <main class="stage" aria-label="Puzzle stage">
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
  background-size: 48px 48px;
  background-position: -1px -1px;
}
</style>
