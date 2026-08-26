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
             positioning this replaced. Below the breakpoint the rails are
             down to the reference thumbnail and the minimap, where the board
             needs every pixel more than a phone needs a HUD. See DECISIONS.
             A panel the player switches off in the options menu is hidden
             where it stands when its place in the column is what positions a
             neighbour (the left rail, where the zoom pillar sits between the
             other two), and simply left out when it positions nobody. -->
        <div class="hud-rail hud-rail-left">
          <ReferencePanel :class="{ 'hud-off': !visiblePanels.reference }" />
          <ZoomControls :class="{ 'hud-off': !visiblePanels.zoom }" />
          <ActivityTicker :class="{ 'hud-off': !visiblePanels.activity }" />
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

/* Left/right HUD columns spanning the stage height. justify-content:
   space-between pins the first child to the top and the last to the bottom;
   with 3 children (reference/zoom/ticker) it also centers the middle one in
   whatever room is actually left between the other two, so a taller or
   shorter sibling on either side never has to be predicted or hardcoded.
   On a phone the left rail is down to the reference panel alone, which
   space-between leaves in its top corner.
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
/* A switched-off panel that still holds a place in its column: hidden where it
   stands, so the panels around it do not move. The paint effects go with it,
   since a box that is not drawn must not leave its blur or its shadow behind on
   the board; the descendant selector is there to outrank the panels' own. */
.hud-rail .hud-off {
  visibility: hidden;
  backdrop-filter: none;
  box-shadow: none;
}
.hud-rail-right {
  right: 16px;
  align-items: flex-end;
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
