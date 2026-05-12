<script setup lang="ts">
import { useMode, type Mode } from "../composables/useMode";

const { mode, setMode } = useMode();

const options: { value: Mode; label: string }[] = [
  { value: "spectator", label: "Spectator" },
  { value: "contributor", label: "Contributor" },
];
</script>

<template>
  <div class="mode-toggle" role="tablist" aria-label="Mode">
    <button
      v-for="opt in options"
      :key="opt.value"
      role="tab"
      :aria-selected="mode === opt.value"
      :class="{ active: mode === opt.value }"
      @click="setMode(opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.mode-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--paper-2);
}
.mode-toggle button {
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  color: var(--ink-3);
  letter-spacing: -0.005em;
  transition: background 160ms ease, color 160ms ease;
}
.mode-toggle button.active {
  background: var(--ink);
  color: var(--ground);
}
</style>
