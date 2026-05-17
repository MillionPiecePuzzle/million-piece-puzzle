<script setup lang="ts">
import { useMode } from "../composables/useMode";

const { mode, setMode } = useMode();

function contribute() {
  setMode("contributor");
}
</script>

<template>
  <button v-if="mode === 'spectator'" class="contribute-fab" @click="contribute">
    <span class="dot" aria-hidden="true"></span>
    Contribute
  </button>
</template>

<style scoped>
.contribute-fab {
  position: absolute;
  right: 20px;
  bottom: 20px;
  z-index: 30;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--ink);
  background: var(--ink);
  color: var(--ground);
  font-size: 14px;
  letter-spacing: -0.005em;
  box-shadow: 0 8px 24px rgba(21, 20, 15, 0.18);
  transition:
    background 160ms ease,
    transform 160ms ease;
}
.contribute-fab:hover {
  background: var(--ink-2);
  transform: translateY(-1px);
}
.contribute-fab .dot {
  width: 8px;
  height: 8px;
  border-radius: 99px;
  background: #6ee7a8;
  box-shadow: 0 0 0 3px rgba(110, 231, 168, 0.25);
}
</style>
