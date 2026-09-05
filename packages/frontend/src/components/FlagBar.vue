<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { FLAG_COLORS, reorderFlag, type BoardFlag } from "../data/boardFlags";
import type { FlagDropTarget } from "../canvas/flagDrop";
import { useBoardFlags } from "../composables/useBoardFlags";
import { useStageControls } from "../composables/useStageControls";
import { useDisplaySettings } from "../composables/useDisplaySettings";

const { t } = useI18n();
const { controls } = useStageControls();
const { flags, canAdd, dropHoverId, add, select, reorder, setDropTargetSource } = useBoardFlags();

// Buttons the canvas hit-tests a dragged cluster against, so releasing over one
// sends the cluster to that flag. Held as elements rather than measured rects:
// the stage reads them once per grab, which is the only moment the geometry has
// to be right, and never while the bar is hidden or between two layouts.
const buttonEls = new Map<string, HTMLButtonElement>();

function setButtonEl(id: string, el: unknown): void {
  if (el instanceof HTMLButtonElement) buttonEls.set(id, el);
  else buttonEls.delete(id);
}

function dropTargets(): FlagDropTarget[] {
  if (!shown.value) return [];
  const targets: FlagDropTarget[] = [];
  for (const flag of flags.value) {
    const el = buttonEls.get(flag.id);
    if (el?.isConnected) targets.push({ id: flag.id, rect: el.getBoundingClientRect() });
  }
  return targets;
}

// Pointer-driven and bottom-center: the bar has no room on a compact viewport,
// where the overview already holds that edge, and the options menu does not offer
// it there. Gated in JS rather than in CSS so the number keys, and the rects a
// drag is hit-tested against, go with it. Left out rather than hidden in place,
// since nothing is positioned against it.
const { visiblePanels } = useDisplaySettings();
const shown = computed(() => visiblePanels.value.flags);

function goTo(flag: BoardFlag): void {
  controls.value?.centerOnWorld(flag.worldX, flag.worldY);
}

function addHere(): void {
  const center = controls.value?.viewportCenterWorld();
  if (!center) return;
  add(center.x, center.y);
}

// Carrying a flag to another slot of the bar. A press is a jump until it travels
// DRAG_THRESHOLD, past which the button follows the pointer and the others slide
// out of its way; the order is committed once, on release, so a slot swept
// through on the way costs neither a storage write nor a rollback. The preview
// is `reorderFlag` itself rather than a second copy of the arithmetic: a button
// is transformed from the slot it sits in to the one that list puts it in, which
// is also the number it wears and the key that jumps to it.
const DRAG_THRESHOLD = 5;

type Press = {
  id: string;
  index: number;
  pointerId: number;
  startX: number;
  startY: number;
  grabX: number;
  grabY: number;
};

let press: Press | null = null;
let slots: DOMRect[] = [];
let suppressClick = false;

const dragId = ref<string | null>(null);
const dragShift = ref({ x: 0, y: 0 });
const targetIndex = ref(0);
const settling = ref(false);

const previewFlags = computed(() =>
  dragId.value ? reorderFlag(flags.value, dragId.value, targetIndex.value) : flags.value,
);

function slotOf(flag: BoardFlag): number {
  return previewFlags.value.findIndex((f) => f.id === flag.id);
}

function buttonStyle(flag: BoardFlag, index: number): Record<string, string> {
  const style: Record<string, string> = { "--flag-color": FLAG_COLORS[flag.color] ?? "" };
  if (!dragId.value) return style;
  if (flag.id === dragId.value) {
    style.transform = `translate(${dragShift.value.x}px, ${dragShift.value.y}px) scale(1.08)`;
    return style;
  }
  const home = slots[index];
  const target = slots[slotOf(flag)];
  if (home && target) {
    style.transform = `translate(${target.left - home.left}px, ${target.top - home.top}px)`;
  }
  return style;
}

// Measured once, when the carry starts: the bar keeps that layout for the whole
// gesture, since the order it draws only changes on release.
function measureSlots(): DOMRect[] | null {
  const rects: DOMRect[] = [];
  for (const flag of flags.value) {
    const el = buttonEls.get(flag.id);
    if (!el?.isConnected) return null;
    rects.push(el.getBoundingClientRect());
  }
  return rects;
}

// Nearest slot center in both axes: the bar wraps inside the strip the two rails
// leave, so a row is not always the whole list and an x-only reading would drop
// a carried flag into the wrong one.
function nearestSlot(x: number, y: number): number {
  let best = 0;
  let bestDistance = Infinity;
  slots.forEach((rect, i) => {
    const dx = x - (rect.left + rect.width / 2);
    const dy = y - (rect.top + rect.height / 2);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  });
  return best;
}

function onFlagPointerDown(flag: BoardFlag, index: number, ev: PointerEvent): void {
  suppressClick = false;
  if (ev.button !== 0 || flags.value.length < 2) return;
  const el = ev.currentTarget;
  if (!(el instanceof HTMLButtonElement)) return;
  const rect = el.getBoundingClientRect();
  press = {
    id: flag.id,
    index,
    pointerId: ev.pointerId,
    startX: ev.clientX,
    startY: ev.clientY,
    grabX: ev.clientX - rect.left,
    grabY: ev.clientY - rect.top,
  };
  // Captured from the press so the carry survives the pointer leaving the button
  // it started on, which it does as soon as the flag has moved a slot.
  el.setPointerCapture(ev.pointerId);
}

function onFlagPointerMove(ev: PointerEvent): void {
  if (!press || ev.pointerId !== press.pointerId) return;
  if (!dragId.value) {
    if (Math.hypot(ev.clientX - press.startX, ev.clientY - press.startY) < DRAG_THRESHOLD) return;
    const measured = measureSlots();
    if (!measured) {
      press = null;
      return;
    }
    slots = measured;
    dragId.value = press.id;
  }
  const home = slots[press.index];
  if (!home) return;
  const left = ev.clientX - press.grabX;
  const top = ev.clientY - press.grabY;
  dragShift.value = { x: left - home.left, y: top - home.top };
  targetIndex.value = nearestSlot(left + home.width / 2, top + home.height / 2);
}

function onFlagPointerUp(ev: PointerEvent): void {
  if (!press || ev.pointerId !== press.pointerId) return;
  const dragged = dragId.value;
  const to = targetIndex.value;
  endPress();
  if (!dragged) return;
  // The click this release is about to raise would jump the camera to a flag the
  // player was carrying, not choosing.
  suppressClick = true;
  reorder(dragged, to);
  settle();
}

function cancelDrag(): void {
  if (!press) return;
  const dragged = dragId.value !== null;
  endPress();
  if (dragged) suppressClick = true;
}

function endPress(): void {
  const el = press ? buttonEls.get(press.id) : null;
  if (press && el?.hasPointerCapture(press.pointerId)) el.releasePointerCapture(press.pointerId);
  press = null;
  dragId.value = null;
}

// The layout has just moved the buttons into the order committed, so the
// transforms that were previewing that same move have to go without animating
// back through it. Two frames: the first is where Vue's patch lands, the second
// where the cleared transform is the browser's own base.
function settle(): void {
  settling.value = true;
  requestAnimationFrame(() => requestAnimationFrame(() => (settling.value = false)));
}

function onFlagClick(flag: BoardFlag): void {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  goTo(flag);
}

// 1 to 8 jump to the flag in that slot. Ignored while a dialog is open or while
// the press is going into a field, so typing a pseudo never moves the board.
function onKeydown(ev: KeyboardEvent): void {
  if (!shown.value) return;
  if (dragId.value !== null) {
    if (ev.key === "Escape") cancelDrag();
    return;
  }
  if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.repeat) return;
  const slot = Number(ev.key);
  if (!Number.isInteger(slot) || slot < 1 || slot > flags.value.length) return;
  const target = ev.target;
  if (
    target instanceof Element &&
    target.closest("input, textarea, select, [contenteditable], [role='dialog']")
  ) {
    return;
  }
  const flag = flags.value[slot - 1];
  if (!flag) return;
  select(null);
  goTo(flag);
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  setDropTargetSource(dropTargets);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  setDropTargetSource(null);
});
</script>

<template>
  <div
    v-if="shown"
    class="flag-bar"
    :class="{ dropping: dropHoverId !== null, reordering: dragId !== null, settling }"
    role="group"
    :aria-label="t('flags.bar')"
  >
    <button
      v-for="(flag, i) in flags"
      :key="flag.id"
      :ref="(el) => setButtonEl(flag.id, el)"
      type="button"
      class="flag-btn"
      :class="{ 'flag-btn-drop': dropHoverId === flag.id, 'flag-btn-drag': dragId === flag.id }"
      :style="buttonStyle(flag, i)"
      :data-tip="t('flags.goTo', { n: slotOf(flag) + 1 })"
      :aria-label="t('flags.goTo', { n: slotOf(flag) + 1 })"
      :disabled="!controls"
      @pointerdown="onFlagPointerDown(flag, i, $event)"
      @pointermove="onFlagPointerMove"
      @pointerup="onFlagPointerUp"
      @pointercancel="cancelDrag"
      @click="onFlagClick(flag)"
    >
      <svg class="ic" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4.6 14.2V2.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <path
          d="M5.5 2.9h6.9l-1.8 2.7 1.8 2.7H5.5z"
          fill="var(--flag-color)"
          stroke="currentColor"
          stroke-width="1.1"
          stroke-linejoin="round"
        />
      </svg>
      <span class="slot" aria-hidden="true">{{ slotOf(flag) + 1 }}</span>
    </button>
    <button
      v-if="canAdd"
      type="button"
      class="flag-add"
      :data-tip="t('flags.add')"
      :aria-label="t('flags.add')"
      :disabled="!controls"
      @click="addHere"
    >
      <svg class="ic" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 3.4v9.2M3.4 8h9.2"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/* Centered in the strip the two rails leave, not on the viewport: nine 51px
   targets come to 455px, which reaches under the activity panel and the
   overview well before a laptop-width screen. Bounding the box to the strip
   (--hud-rail-max comes from .stage in PlayPage.vue) wraps the row inside it
   instead of sliding it under either panel; the rails are capped at the same
   width on both sides, so the bar still reads as centered. */
.flag-bar {
  position: absolute;
  left: calc(16px + var(--hud-rail-max) + 12px);
  right: calc(16px + var(--hud-rail-max) + 12px);
  bottom: 16px;
  width: fit-content;
  margin: 0 auto;
  z-index: 10;
  pointer-events: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 6px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-panel);
}
.flag-bar button {
  position: relative;
  width: 51px;
  height: 51px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--ink-2);
  transition:
    transform 140ms ease,
    box-shadow 140ms ease,
    background 140ms ease;
}
.flag-bar button:hover:not(:disabled) {
  background: var(--paper-2);
}
.flag-bar button:disabled {
  color: var(--ink-4);
  cursor: default;
}
.flag-add {
  color: var(--ink-3);
}
/* A carry has to reach the pointer wherever it goes, including through the
   browser's own touch panning. */
.flag-btn {
  touch-action: none;
}
.flag-btn .slot {
  position: absolute;
  right: 5px;
  bottom: 3px;
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1;
  color: var(--ink-4);
}
.flag-bar button::after {
  content: attr(data-tip);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
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
.flag-bar button:hover:not(:disabled)::after {
  opacity: 1;
}
/* A cluster dragged over the bar leaves CSS :hover on whichever button it
   crosses, so the "go to flag" tooltip would contradict what the release does. */
.flag-bar.dropping button::after {
  opacity: 0;
}
/* The dragged cluster is painted in the canvas, under this bar, and no stacking
   order can lift a WebGL draw above a DOM overlay. Thinning the bar out while it
   holds a cluster is the closest thing: the piece reads as passing over the flags
   instead of vanishing behind them. */
.flag-bar.dropping {
  background: rgba(255, 255, 255, 0.26);
  box-shadow: none;
}
.flag-bar.dropping button:not(.flag-btn-drop) {
  opacity: 0.4;
}
/* The button a released cluster would be sent to, marked while the cluster
   shrinks toward it on the canvas. Ringed rather than filled: the fill would hide
   the piece behind it, and the pennant inside the glyph is that same color. */
.flag-bar button.flag-btn-drop:not(:disabled) {
  background: transparent;
  color: var(--ink);
  box-shadow: 0 0 0 3px var(--flag-color);
  transform: scale(1.16);
}
/* A carried flag is glued to the pointer, so it takes no transition of its own,
   and it draws over the buttons sliding out of its way. */
.flag-bar button.flag-btn-drag {
  transition: none;
  z-index: 1;
  cursor: grabbing;
  background: var(--paper-2);
  box-shadow: var(--shadow-panel);
}
/* The tooltip names the slot a button stands in, which is the one thing a carry
   is in the middle of changing. */
.flag-bar.reordering button::after {
  opacity: 0;
}
/* One frame with the transforms cleared onto the order just committed: the
   layout has already made that move, and animating it out would play it twice. */
.flag-bar.settling button {
  transition: none;
}
.ic {
  width: 24px;
  height: 24px;
  display: block;
}
</style>
