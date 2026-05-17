<script setup lang="ts">
import { useMode } from "../composables/useMode";
import { useAuthModal } from "../composables/useAuthModal";

const { mode } = useMode();
const { show } = useAuthModal();
</script>

<template>
  <div v-if="mode === 'spectator'" class="contribute-card" role="region" aria-label="Spectator mode">
    <p class="status">You are currently in spectator mode</p>
    <p class="prompt">Become a contributor</p>
    <button class="cta" @click="show">Contribute</button>
  </div>
</template>

<style scoped>
.contribute-card {
  position: absolute;
  right: 20px;
  bottom: 20px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 14px 16px 14px 16px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(10px);
  box-shadow: 0 12px 32px rgba(21, 20, 15, 0.16);
  max-width: 280px;
}
.status {
  margin: 0;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.prompt {
  margin: 0 0 8px;
  font-family: var(--serif);
  font-weight: 500;
  font-size: 16px;
  letter-spacing: -0.01em;
  color: var(--ink);
}
.cta {
  align-self: stretch;
  padding: 10px 18px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--ink);
  background: var(--ink);
  color: var(--ground);
  font-size: 14px;
  letter-spacing: -0.005em;
  transition:
    background 160ms ease,
    transform 160ms ease;
}
.cta:hover {
  background: var(--ink-2);
  transform: translateY(-1px);
}
</style>
