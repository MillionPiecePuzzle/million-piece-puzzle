<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import TopBar from "../components/TopBar.vue";
import PuzzleCanvas from "../components/PuzzleCanvas.vue";
import ZoomControls from "../components/ZoomControls.vue";
import ActivityTicker from "../components/ActivityTicker.vue";
import LeaderboardPanel from "../components/LeaderboardPanel.vue";
import ReferencePanel from "../components/ReferencePanel.vue";
import MiniMap from "../components/MiniMap.vue";
import FlagBar from "../components/FlagBar.vue";
import FlagPopover from "../components/FlagPopover.vue";
import DevControls from "../components/DevControls.vue";
import { useStageControls } from "../composables/useStageControls";
import { useDisplaySettings } from "../composables/useDisplaySettings";
import { GRID_WORLD_CELL } from "@mpp/shared";

const { t } = useI18n();
const { camera, ready } = useStageControls();
const { visiblePanels } = useDisplaySettings();

// Drive the CSS hairline grid from world space: one cell is GRID_WORLD_CELL
// world units, so the grid scales and pans with the canvas. The play zone is
// snapped to the same pitch so its backdrop edge lands on a grid line.
const backdropVars = computed(() => ({
  "--grid-cell": `${GRID_WORLD_CELL * camera.value.zoom}px`,
  "--grid-x": `${camera.value.x}px`,
  "--grid-y": `${camera.value.y}px`,
}));

// The zoom pillar is the left rail's middle child, so space-between places it in
// whatever room the reference panel above and the ticker below actually leave:
// dropping either out of the column would slide the pillar somewhere else on
// screen. While the pillar is on, a switched-off neighbour therefore keeps its
// slot and only stops being drawn. Nothing is held for a pillar that is off,
// which is every phone by default, so no panel a phone hides stays mounted.
const holdLeftSlots = computed(() => visiblePanels.value.zoom);

const devButtonsEnabled = import.meta.env.VITE_DEV_BUTTONS !== "0";
</script>

<template>
  <div class="play">
    <TopBar />
    <main class="stage" :aria-label="t('play.stage')" :style="backdropVars">
      <PuzzleCanvas />
      <template v-if="ready">
        <!-- Two independent flex columns, each spanning the stage height with
             justify-content:space-between: panels can never overlap each
             other regardless of their own content-driven size (a portrait
             reference image, a long activity list, a full leaderboard, ...)
             or the viewport's height, unlike the corner-anchored absolute
             positioning this replaced. The player switches them on and off one
             by one from the options menu, and an untouched one follows its
             viewport default, which below the breakpoint is the reference
             thumbnail and the minimap alone, where the board needs every pixel
             more than a phone needs a HUD. Switching one off never moves the
             others: a panel whose slot still holds the pillar in place stays in
             the column and only stops being drawn (slotHeld). See DECISIONS. -->
        <div class="hud-rail hud-rail-left">
          <!-- Wrapped rather than classed directly: ReferencePanel's template has
               two roots (the panel and its modal), so a class set here on the
               component is dropped, and the ticker follows the same shape. -->
          <div
            v-if="visiblePanels.reference || holdLeftSlots"
            :class="{ 'slot-held': !visiblePanels.reference }"
          >
            <ReferencePanel />
          </div>
          <ZoomControls v-if="visiblePanels.zoom" />
          <div
            v-if="visiblePanels.activity || holdLeftSlots"
            class="slot-bottom"
            :class="{ 'slot-held': !visiblePanels.activity }"
          >
            <ActivityTicker />
          </div>
        </div>
        <div class="hud-rail hud-rail-right">
          <LeaderboardPanel v-if="visiblePanels.leaderboard" />
          <div class="hud-bottom-right">
            <DevControls v-if="devButtonsEnabled" />
            <MiniMap v-if="visiblePanels.minimap" />
          </div>
        </div>
        <FlagBar />
        <FlagPopover />
      </template>
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
  background-size: var(--grid-cell, 80px) var(--grid-cell, 80px);
  background-position: var(--grid-x, 0) var(--grid-y, 0);
}

/* Left/right HUD columns spanning the stage height. Each rail holds exactly two
   slots, a top one and a bottom group, so a panel switched off never moves the
   ones still on: the ticker holds the bottom corner whether or not the zoom
   pillar above it is there, and both hold it whether or not the reference panel
   is. justify-content:space-between pins the first child to the top; the group
   carries its own margin-top:auto so it stays pinned with the top slot gone.
   pointer-events:none lets drags reach the canvas in the gaps; each panel
   (.panel, .zoom, .dev-controls) re-enables it on itself. */
.hud-rail {
  position: absolute;
  top: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  pointer-events: none;
}
.hud-rail-left {
  left: 16px;
  align-items: flex-start;
}
.hud-rail-right {
  right: 16px;
  align-items: flex-end;
}
/* A panel switched off whose slot is still load-bearing: the box keeps its place
   and its size in the column, and paints nothing. visibility rather than a
   display:none or a v-if because only a box that still measures can hold a
   place, and unlike an opacity:0 one it takes no pointer, no focus and no line
   in the accessibility tree. */
.slot-held {
  visibility: hidden;
}
/* The ticker is the rail's bottom anchor. As the last of several children
   space-between already leaves it there; alone in the column it would sit at
   the top instead. */
.slot-bottom:only-child {
  margin-top: auto;
}
/* max-width mirrors every panel's own min(fixedCap, 50vw-24px) sizing: as
   long as every element on both rails is bounded the same way, no left-rail
   item plus right-rail item can ever together exceed the viewport width. Without
   it this group (dev-only controls pill + minimap) has no cap of its own and
   can run wide enough to reach into the activity ticker on the other rail.
   flex-wrap lets it reflow instead of overflowing once capped: DevControls is
   first in DOM/first flex line, so it is what drops to its own row above; the
   minimap, second/last, always stays the bottom-most line and keeps its
   corner position. */
.hud-bottom-right {
  /* Pins itself to the rail's bottom edge on its own: below the breakpoint the
     leaderboard above it is gone, and space-between with a single child would
     otherwise park the minimap at the top of the rail. */
  margin-top: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 16px;
  max-width: calc(50vw - 24px);
}

@media (max-width: 680px) {
  .hud-rail {
    top: 10px;
    bottom: 10px;
  }
  .hud-rail-left {
    left: 10px;
  }
  .hud-rail-right {
    right: 10px;
  }
  .hud-bottom-right {
    gap: 10px;
  }
}
</style>
