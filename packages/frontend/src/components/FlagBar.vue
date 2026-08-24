<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { FLAG_COLORS, type BoardFlag } from "../data/boardFlags";
import { useBoardFlags } from "../composables/useBoardFlags";
import { useStageControls } from "../composables/useStageControls";

const { t } = useI18n();
const { controls } = useStageControls();
const { flags, canAdd, add, select } = useBoardFlags();

// Pointer-driven and bottom-center: the bar has no room on a phone, where the
// activity ticker and the minimap already share that edge. Gated in JS rather
// than in CSS so the number keys go with it.
const WIDE_QUERY = "(min-width: 681px)";
const wide = ref(true);
let media: MediaQueryList | null = null;

function syncWide(): void {
  wide.value = media?.matches ?? true;
}

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
  media = window.matchMedia(WIDE_QUERY);
  syncWide();
  media.addEventListener("change", syncWide);
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  media?.removeEventListener("change", syncWide);
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div v-if="wide" class="flag-bar" role="group" :aria-label="t('flags.bar')">
    <button
      v-for="(flag, i) in flags"
      :key="flag.id"
      type="button"
      class="flag-btn"
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
  gap: 2px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-panel);
}
.flag-bar button {
  position: relative;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--ink-2);
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
  right: 3px;
  bottom: 1px;
  font-family: var(--mono);
  font-size: 8px;
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
.ic {
  width: 16px;
  height: 16px;
  display: block;
}
</style>
