<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { MIN_OVERVIEW_ASPECT, drawOverview, overviewAspect } from "../canvas/overviewView";
import {
  boardToWorld,
  clampWorldToZone,
  formatBoardPoint,
  parseBoardPoint,
  worldToBoard,
} from "../canvas/boardCoords";
import { pushEscapeHandler } from "../escapeStack";
import { useOverview } from "../composables/useOverview";
import { useOverviewPointer } from "../composables/useOverviewPointer";
import { useBoardFlags } from "../composables/useBoardFlags";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { useStageControls } from "../composables/useStageControls";
import { useCompactViewport } from "../composables/useCompactViewport";
import { useRafLoop } from "../composables/useRafLoop";
import OverviewModal from "./OverviewModal.vue";

const { t } = useI18n();
const { source, navigate } = useOverview();
const { flags } = useBoardFlags();
const { onlineCount, state } = usePuzzleSession();
const { camera } = useStageControls();
// A compact panel is 128px of row against the 167px the longest label and the
// longest reading need, so the readout stays off a small screen, where it has
// never been drawn: the zoom pillar it comes from is not offered there either.
const { compact } = useCompactViewport();
const canvasEl = ref<HTMLCanvasElement | null>(null);
const ready = ref(false);
const enlarged = ref(false);

const { captureTransform, onPointerDown, onPointerMove, onPointerUp } =
  useOverviewPointer(canvasEl);

const canvasAspect = ref(MIN_OVERVIEW_ASPECT);

// Where the middle of the view sits in player coordinates: whole pieces from
// the center of the frame, so a player can read their spot out to someone. It
// belongs under the map it is a reading of, rather than on the zoom pillar.
const position = computed(() => {
  const s = state.value;
  if (s.kind !== "ready") return null;
  return formatBoardPoint(worldToBoard(camera.value.centerX, camera.value.centerY, s.manifest));
});

// The row reads a point in as well as out, since it is the one control in the
// game that already speaks board coordinates: what someone reads out to another
// player has somewhere to be typed, and the camera moves there at the zoom it is
// already at, a written point standing for a place and no scale like a bookmark.
const editing = ref(false);
const draft = ref("");
const fieldEl = ref<HTMLInputElement | null>(null);
const readingEl = ref<HTMLButtonElement | null>(null);

// A field the player is still filling is unfinished rather than wrong, so the
// mark waits until there is something to read.
const readable = computed(() => draft.value.trim() === "" || parseBoardPoint(draft.value) !== null);

// The box the reading and the field share, held at the widest reading there is:
// the camera roams the whole play zone, not the frame, so a spot out past the
// board's edge is where a coordinate spends its characters.
const positionChars = computed(() => {
  const s = state.value;
  if (s.kind !== "ready") return 0;
  const zone = s.welcome.playZone;
  const min = worldToBoard(zone.minX, zone.minY, s.manifest);
  const max = worldToBoard(zone.maxX, zone.maxY, s.manifest);
  return formatBoardPoint({ x: wider(min.x, max.x), y: wider(min.y, max.y) }).length;
});

// Whichever end of an axis writes the most characters, a minus sign counted.
function wider(a: number, b: number): number {
  return String(Math.round(a)).length >= String(Math.round(b)).length ? a : b;
}

function startEditing(): void {
  if (!position.value) return;
  draft.value = position.value;
  editing.value = true;
  // Selected rather than only focused: the reading is already in the box, and a
  // player opening it means to write another point, not to amend this one.
  void nextTick(() => fieldEl.value?.select());
}

// Escape and a click away both put the reading back untouched. The field moves
// the camera on Enter alone, so reaching for the board while a point is half
// written never teleports the player away from what they were reading.
function stopEditing(): void {
  // Escape leaves the field holding the focus it took, so it is handed back to
  // the reading it reopens from. A click away is not followed: the focus is
  // already where the player just put it.
  const held = document.activeElement === fieldEl.value;
  editing.value = false;
  if (held) void nextTick(() => readingEl.value?.focus());
}

function submit(): void {
  const s = state.value;
  if (s.kind !== "ready") return;
  const point = parseBoardPoint(draft.value);
  // An unreadable point leaves the camera where it stands and the field open on
  // what was typed, so the player fixes it rather than writes it again.
  if (point === null) return;
  const world = clampWorldToZone(boardToWorld(point.x, point.y, s.manifest), s.welcome.playZone);
  stopEditing();
  navigate.value?.(world.x, world.y);
}

let releaseEscape: (() => void) | null = null;
watch(editing, (open) => {
  if (open) {
    releaseEscape = pushEscapeHandler(stopEditing);
    return;
  }
  releaseEscape?.();
  releaseEscape = null;
});
onBeforeUnmount(() => releaseEscape?.());

// A window narrowing onto the compact breakpoint takes the field down with the
// row, so no press of Escape is caught by a field nobody can see.
const showPosition = computed(() => position.value !== null && !compact.value);
watch(showPosition, (shown) => {
  if (!shown) stopEditing();
});

function draw(): void {
  // The enlarged view covers the HUD with its own backdrop and paints the same
  // map, so the panel stops working entirely while it is open rather than
  // building the overview twice a frame: the snapshot costs as much as the
  // paint it feeds, both scaling with the known-piece count, which runs into
  // thousands of dots on the 1M board. `ready` cannot go stale meanwhile: the
  // view only opens from a panel that is already showing.
  if (enlarged.value) return;

  // The overview stays hidden until the stage has a play zone, so it never
  // shows a placeholder shape that would resize once real data arrives.
  const snap = source.value?.() ?? null;
  ready.value = snap !== null;
  if (!snap) return;

  // Shaped to the play zone plus its out-of-bounds band, so the map fills the
  // canvas with no letterbox. Set before painting, so the panel appears at its
  // final shape rather than resizing after its first frame.
  const aspect = overviewAspect(snap);
  if (aspect === null) return;
  canvasAspect.value = aspect;

  const canvas = canvasEl.value;
  if (!canvas) return;
  captureTransform(drawOverview(canvas, snap, flags.value));
}

useRafLoop(draw);
</script>

<template>
  <aside
    v-show="ready"
    class="panel overview"
    :style="{ '--ar': canvasAspect }"
    :aria-label="t('overview.title')"
  >
    <div class="overview-head">
      <h3>{{ t("overview.title") }}</h3>
      <div class="overview-head-right">
        <span
          v-if="onlineCount >= 2"
          class="online-count"
          :title="t('overview.online', { n: onlineCount })"
        >
          <span class="online-dot" aria-hidden="true"></span>
          {{ onlineCount }}
        </span>
        <button
          type="button"
          class="expand"
          :disabled="!ready"
          :aria-label="t('overview.enlarge')"
          @click="enlarged = true"
        >
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
    <div class="overview-canvas">
      <canvas
        ref="canvasEl"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      ></canvas>
    </div>
    <div
      v-if="showPosition"
      class="coords"
      :style="{ '--coords-ch': positionChars }"
      :title="t('overview.coordinatesHint')"
    >
      <span class="coords-label">{{ t("overview.coordinates") }}</span>
      <input
        v-if="editing"
        ref="fieldEl"
        v-model="draft"
        class="coords-value coords-field"
        :class="{ unreadable: !readable }"
        type="text"
        autocomplete="off"
        spellcheck="false"
        :aria-label="t('overview.coordinatesField')"
        :aria-invalid="!readable"
        @keyup.enter="submit"
        @blur="stopEditing"
      />
      <button
        v-else
        ref="readingEl"
        type="button"
        class="coords-value coords-open"
        :title="t('overview.coordinatesGo')"
        @click="startEditing"
      >
        {{ position }}
      </button>
    </div>
  </aside>

  <OverviewModal v-if="enlarged" @close="enlarged = false" />
</template>

<style scoped>
/* Last cap: the room the right rail has left once the topbar, its own insets, a
   readable contributors list and this panel's own chrome (the coordinates row
   included, 22px of it) are taken out, converted to a width through the map's
   aspect. Same reasoning as the reference panel, so a short window shrinks the
   map instead of pushing it off the screen. */
.overview {
  position: static;
  width: min(248px, var(--hud-rail-max), calc((100dvh - 322px) * var(--ar)));
  padding: 10px 10px 12px;
}
.overview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding: 0 4px;
}
.overview-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.online-count {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--ink-2);
}
.online-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #34a853;
  flex: none;
}
.overview-canvas {
  position: relative;
  width: 100%;
  aspect-ratio: var(--ar);
  border-radius: 8px;
  overflow: hidden;
  background: #e9e3d3;
  border: 1px solid var(--line-2);
}
.overview-canvas canvas {
  display: block;
  width: 100%;
  height: 100%;
  /* Plain arrow rather than a grab hand: the press aims the camera at a point
     instead of picking the map up, and the arrow's tip is what aims it. */
  cursor: default;
  touch-action: none;
}
/* Inset like the panel's own head, so the label lines up with the title above
   the map and the reading ends on the map's right edge. */
.coords {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 8px 0 0;
  padding: 0 4px;
  /* The widest reading there is, plus the insets box-sizing then takes back out
     of the content box. Every character of a coordinate is one advance wide in
     the mono face, so the count is the whole measurement. */
  --coords-box: calc(var(--coords-ch) * 1ch + 10px);
}
/* The box holds its width, so the label is what gives when the panel is at its
   narrowest above the compact breakpoint (a short window shrinks it through the
   map's aspect): cut with an ellipsis rather than wrapped under the reading. */
.coords-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--ink-3);
}
/* The reading and the field are one box in two states, down to the border the
   reading carries unpainted: same width whatever it reads, same insets, same
   baseline, so the row holds still under the player's hand as they pan and
   neither it nor the panel above it (sized against its own chrome) moves when
   one opens over the other. Reaching back out to the row's inset, the box ends
   on the map's right edge. */
.coords-value {
  flex: none;
  min-width: var(--coords-box);
  margin: -2px -4px;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-btn);
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-2);
  white-space: nowrap;
  text-align: right;
}
.coords-open:hover {
  background: var(--paper-2);
  color: var(--ink);
}
/* An input carries a default width of its own, so the box is set on it rather
   than only allowed for. */
.coords-field {
  width: var(--coords-box);
  border-color: var(--line);
  background: var(--paper);
  color: var(--ink);
}
.coords-field:focus {
  outline: none;
  border-color: var(--ink-3);
}
.coords-field.unreadable {
  border-color: oklch(0.55 0.18 30);
}
.expand {
  flex: none;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  background: none;
  border-radius: var(--radius-btn);
  cursor: pointer;
}
.expand:hover:not(:disabled) {
  background: var(--paper-2);
}
.expand:disabled {
  cursor: default;
  opacity: 0.5;
}
.expand svg {
  width: 13px;
  height: 13px;
  display: block;
}

/* The rail is down to this panel alone here, so the height budget drops to the
   topbar, the tighter insets and this panel's own chrome. */
@media (max-width: 680px), (max-height: 480px) {
  .overview {
    width: min(152px, calc(50vw - 20px), calc((100dvh - 120px) * var(--ar)));
    padding: 8px 8px 9px;
  }
}
</style>
