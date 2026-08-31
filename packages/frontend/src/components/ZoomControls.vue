<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStageControls } from "../composables/useStageControls";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { formatBoardPoint, worldToBoard } from "../canvas/boardCoords";

const { t } = useI18n();
const { controls, camera, zoomPercent } = useStageControls();
const { state } = usePuzzleSession();

// Where the middle of the view sits in player coordinates: whole pieces from
// the center of the frame, so a player can read their spot out to someone.
const position = computed(() => {
  const s = state.value;
  if (s.kind !== "ready") return null;
  return formatBoardPoint(worldToBoard(camera.value.centerX, camera.value.centerY, s.manifest));
});
</script>

<template>
  <div class="zoom">
    <div v-if="position" class="pos" :data-tip="t('zoom.position')">{{ position }}</div>
    <div class="lvl">{{ zoomPercent }}%</div>
    <button
      type="button"
      :aria-label="t('zoom.in')"
      :data-tip="t('zoom.in')"
      :disabled="!controls"
      @click="controls?.zoomIn()"
    >
      <svg class="ic" viewBox="0 0 16 16" fill="none">
        <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    </button>
    <button
      type="button"
      :aria-label="t('zoom.out')"
      :data-tip="t('zoom.out')"
      :disabled="!controls"
      @click="controls?.zoomOut()"
    >
      <svg class="ic" viewBox="0 0 16 16" fill="none">
        <path d="M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    </button>
    <button
      type="button"
      :aria-label="t('zoom.center')"
      :data-tip="t('zoom.center')"
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
      :aria-label="t('zoom.fit')"
      :data-tip="t('zoom.fit')"
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
/* Vertically centered in whatever room the rail's space-between leaves
   between the reference panel above and the activity panel below (see
   PlayPage.vue .hud-rail-left), not the stage's own true center. */
.zoom {
  /* Matches the HUD z-index convention in base.css .panel: without it this
     panel sits at the default stacking level (0), below both the puzzle
     canvas (z-index 1) and the stage's grid/dot backdrop (last in DOM
     order among the z-index:auto siblings), so the canvas texture painted
     on top instead of behind it. */
  z-index: 10;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  border: 1px solid var(--line);
  border-radius: 12px;
}
/* The position readout is the widest thing in the pillar, so it, and not the
   button row, is what the pillar's width comes from; the buttons stretch to it
   rather than carrying a width of their own. */
.pos,
.lvl {
  --pad-x: 8px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-3);
  padding: 6px var(--pad-x);
  text-align: center;
  white-space: nowrap;
  border-bottom: 1px solid var(--line-2);
}
/* Whichever line is on top, since the readout is only drawn once the board is
   up and the zoom level leads until then. */
.zoom > :first-child {
  border-radius: 12px 12px 0 0;
}
.pos {
  position: relative;
  color: var(--ink-2);
  /* Held at the width of the longest reading the play zone can produce (four
     digits and a sign an axis, out at its corner), so the pillar keeps one
     width instead of resizing under the player's hand as they pan. The font is
     monospace, so one ch is exactly one character. */
  min-width: calc(14ch + 2 * var(--pad-x));
}
.zoom button {
  position: relative;
  min-width: 36px;
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
.zoom [data-tip]::after {
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
.zoom [data-tip]:hover:not(:disabled)::after {
  opacity: 1;
}
.ic {
  width: 16px;
  height: 16px;
  display: block;
}
</style>
