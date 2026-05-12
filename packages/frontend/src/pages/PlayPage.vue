<script setup lang="ts">
import TopBar from "../components/TopBar.vue";
import { useMode } from "../composables/useMode";

const { mode } = useMode();
</script>

<template>
  <div class="play">
    <TopBar />
    <main class="stage" aria-label="Puzzle stage">
      <div class="stage-placeholder">
        <p class="label">Mode</p>
        <p class="value">{{ mode }}</p>
        <p class="hint">
          Canvas rendering will mount here (track frontend-canvas).
        </p>
      </div>
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
  background:
    radial-gradient(circle at 50% 40%, #faf7f0 0%, #efeadd 70%, #e7e1d1 100%);
  display: grid;
  place-items: center;
}
.stage::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    radial-gradient(rgba(21, 20, 15, 0.035) 1px, transparent 1.2px);
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
.stage-placeholder {
  position: relative;
  z-index: 1;
  text-align: center;
  color: var(--ink-3);
}
.stage-placeholder .label {
  margin: 0 0 4px;
  font-family: var(--mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-4);
}
.stage-placeholder .value {
  margin: 0 0 12px;
  font-family: var(--serif);
  font-size: 28px;
  color: var(--ink);
  text-transform: capitalize;
}
.stage-placeholder .hint {
  margin: 0;
  font-size: 13px;
}
</style>
