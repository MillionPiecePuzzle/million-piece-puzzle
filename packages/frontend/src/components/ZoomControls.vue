<script setup lang="ts">
// Chrome only: the canvas zoom pipeline is not wired in Phase 0.
</script>

<template>
  <div class="zoom">
    <div class="lvl">62%</div>
    <button type="button" title="Zoom in">
      <svg class="ic" viewBox="0 0 16 16" fill="none">
        <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    </button>
    <button type="button" title="Zoom out">
      <svg class="ic" viewBox="0 0 16 16" fill="none">
        <path d="M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    </button>
    <button type="button" title="Center">
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
    <button type="button" title="Fit to view">
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
  overflow: hidden;
}
.lvl {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-3);
  padding: 6px 0;
  text-align: center;
  border-bottom: 1px solid var(--line-2);
}
.zoom button {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  border-bottom: 1px solid var(--line-2);
}
.zoom button:last-child {
  border-bottom: none;
}
.zoom button:hover {
  background: var(--paper-2);
}
.ic {
  width: 16px;
  height: 16px;
  display: block;
}
</style>
