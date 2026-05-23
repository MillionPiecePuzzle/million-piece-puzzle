<script setup lang="ts">
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { useMode } from "../composables/useMode";

const { sendDevReset, sendDevComplete } = usePuzzleSession();
const { mode } = useMode();

function onReset(): void {
  if (!confirm("Reset the current puzzle for everyone?")) return;
  sendDevReset();
}

function onComplete(): void {
  if (!confirm("Force-complete the current puzzle for everyone?")) return;
  sendDevComplete();
}
</script>

<template>
  <div v-if="mode === 'contributor'" class="dev-controls" role="group" aria-label="Dev controls">
    <span class="kicker">Dev</span>
    <button type="button" class="dev-btn" @click="onReset">Reset puzzle</button>
    <button type="button" class="dev-btn warn" @click="onComplete">Complete</button>
  </div>
</template>

<style scoped>
.dev-controls {
  position: absolute;
  /* Sits left of the minimap panel (right: 16px, width: 248px). */
  right: 280px;
  bottom: 20px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  backdrop-filter: blur(8px);
  box-shadow: var(--shadow-panel);
  z-index: 3;
}
.kicker {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-4);
  padding-right: 4px;
  border-right: 1px solid var(--line);
}
.dev-btn {
  appearance: none;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 6px 12px;
  background: var(--paper);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition:
    background 140ms ease,
    color 140ms ease;
}
.dev-btn:hover {
  background: var(--paper-2);
}
.dev-btn.warn {
  color: oklch(0.55 0.18 30);
  border-color: oklch(0.55 0.18 30 / 0.4);
}
.dev-btn.warn:hover {
  background: oklch(0.95 0.05 30);
}
</style>
