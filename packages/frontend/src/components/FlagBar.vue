<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { FLAG_COLORS, type BoardFlag } from "../data/boardFlags";
import type { FlagDropTarget } from "../canvas/flagDrop";
import { useBoardFlags } from "../composables/useBoardFlags";
import { useStageControls } from "../composables/useStageControls";
import { useWideViewport } from "../composables/useWideViewport";

const { t } = useI18n();
const { controls } = useStageControls();
const { flags, canAdd, dropHoverId, add, select, setDropTargetSource } = useBoardFlags();

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
  if (!wide.value) return [];
  const targets: FlagDropTarget[] = [];
  for (const flag of flags.value) {
    const el = buttonEls.get(flag.id);
    if (el?.isConnected) targets.push({ id: flag.id, rect: el.getBoundingClientRect() });
  }
  return targets;
}

// Pointer-driven and bottom-center: the bar has no room on a phone, where the
// zoom controls and the minimap already hold that edge. Gated in JS rather than
// in CSS so the number keys go with it.
const { wide } = useWideViewport();

function goTo(flag: BoardFlag): void {
  controls.value?.centerOnWorld(flag.worldX, flag.worldY);
}

function addHere(): void {
  const center = controls.value?.viewportCenterWorld();
  if (!center) return;
  add(center.x, center.y);
}

// 1 to 8 jump to the flag in that slot. Ignored while a dialog is open or while
// the press is going into a field, so typing a pseudo never moves the board.
function onKeydown(ev: KeyboardEvent): void {
  if (!wide.value || ev.altKey || ev.ctrlKey || ev.metaKey || ev.repeat) return;
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
    v-if="wide"
    class="flag-bar"
    :class="{ dropping: dropHoverId !== null }"
    role="group"
    :aria-label="t('flags.bar')"
  >
    <button
      v-for="(flag, i) in flags"
      :key="flag.id"
      :ref="(el) => setButtonEl(flag.id, el)"
      type="button"
      class="flag-btn"
      :class="{ 'flag-btn-drop': dropHoverId === flag.id }"
      :style="{ '--flag-color': FLAG_COLORS[flag.color] }"
      :data-tip="t('flags.goTo', { n: i + 1 })"
      :aria-label="t('flags.goTo', { n: i + 1 })"
      :disabled="!controls"
      @click="goTo(flag)"
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
      <span class="slot" aria-hidden="true">{{ i + 1 }}</span>
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
.flag-bar {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 10;
  pointer-events: auto;
  display: flex;
  align-items: center;
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
.ic {
  width: 24px;
  height: 24px;
  display: block;
}
</style>
