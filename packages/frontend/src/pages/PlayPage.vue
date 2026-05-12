<script setup lang="ts">
import TopBar from "../components/TopBar.vue";
import PuzzleCanvas from "../components/PuzzleCanvas.vue";
</script>

<template>
  <div class="play">
    <TopBar />
    <main class="stage" aria-label="Puzzle stage">
      <PuzzleCanvas />
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
}
</style>
