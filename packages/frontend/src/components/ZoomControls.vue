<script setup lang="ts">
import { useStageControls } from "../composables/useStageControls";

const { controls, zoomPercent } = useStageControls();
</script>

<template>
  <div class="zoom">
    <div class="lvl">{{ zoomPercent }}%</div>
    <button
      type="button"
      aria-label="Zoom in"
      data-tip="Zoom in"
      :disabled="!controls"
      @click="controls?.zoomIn()"
    >
      <svg class="ic" viewBox="0 0 16 16" fill="none">
        <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    </button>
    <button
      type="button"
      aria-label="Zoom out"
      data-tip="Zoom out"
      :disabled="!controls"
      @click="controls?.zoomOut()"
    >
      <svg class="ic" viewBox="0 0 16 16" fill="none">
        <path d="M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    </button>
    <button
      type="button"
      aria-label="Center on puzzle"
      data-tip="Center on puzzle"
      :disabled="!controls"
      @click="controls?.center()"
    >
      <svg class="ic" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4" />
        <path
          d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
        />
      </svg>
    </button>
    <button
      type="button"
      aria-label="Fit puzzle to view"
      data-tip="Fit puzzle to view"
      :disabled="!controls"
      @click="controls?.fit()"
    >
      <svg class="ic" viewBox="0 0 16 16" fill="none">
        <path
          d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.zoom {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  border: 1px solid var(--line);
  border-radius: 12px;
}
.lvl {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-3);
  padding: 6px 0;
  text-align: center;
  border-bottom: 1px solid var(--line-2);
  border-radius: 12px 12px 0 0;
}
.zoom button {
  position: relative;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  border-bottom: 1px solid var(--line-2);
}
.zoom button:last-child {
  border-bottom: none;
  border-radius: 0 0 12px 12px;
}
.zoom button:hover:not(:disabled) {
  background: var(--paper-2);
}
.zoom button:disabled {
  color: var(--ink-4);
  cursor: default;
}
.zoom button::after {
  content: attr(data-tip);
  position: absolute;
  left: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  background: var(--ink);
  color: var(--ground);
  font-size: 11px;
  padding: 4px 8px;
  border-radius: var(--radius-btn);
  box-shadow: var(--shadow-panel);
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}
.zoom button:hover:not(:disabled)::after {
  opacity: 1;
}
.ic {
  width: 16px;
  height: 16px;
  display: block;
}
</style>
