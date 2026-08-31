<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ImageManifest } from "@mpp/shared";
import { useOverview } from "../composables/useOverview";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useBackdropClick } from "../composables/useBackdropClick";
import ReferenceViewer from "./ReferenceViewer.vue";

const { t } = useI18n();
const props = defineProps<{ manifest: ImageManifest }>();
const emit = defineEmits<{ close: [] }>();

const viewer = ref<InstanceType<typeof ReferenceViewer> | null>(null);
const shellEl = ref<HTMLElement | null>(null);
const trap = useFocusTrap(shellEl, { onEscape: () => emit("close") });
const { onMousedown, onClick } = useBackdropClick(() => emit("close"));
const { navigate } = useOverview();
// Armed from the control pillar, so the gesture is discoverable without the
// modifier. Ctrl (or Cmd) does the same thing whether it is armed or not.
const aiming = ref(false);

const aspectRatio = computed(() => `${props.manifest.source.width / props.manifest.source.height}`);

function zoomBy(factor: number): void {
  viewer.value?.zoomBy(factor);
}

function fit(): void {
  viewer.value?.fit();
}

// Aim the board from the photo. The pyramid is the cropped source
// (`cols * pieceSize` by `rows * pieceSize`), so it maps 1:1 onto the puzzle
// frame and an image pixel names a world point.
function onPick(image: { x: number; y: number }): void {
  const { rows, cols, pieceSize, source } = props.manifest;
  navigate.value?.(
    (image.x / source.width) * cols * pieceSize,
    (image.y / source.height) * rows * pieceSize,
  );
}

onMounted(trap.activate);
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @mousedown="onMousedown" @click="onClick">
      <div
        ref="shellEl"
        class="shell"
        role="dialog"
        aria-modal="true"
        :aria-label="t('reference.image')"
        :style="{ '--ar': aspectRatio }"
      >
        <button type="button" class="close" :aria-label="t('common.close')" @click="emit('close')">
          &times;
        </button>
        <ReferenceViewer
          ref="viewer"
          class="osd-large"
          :manifest="manifest"
          :aiming="aiming"
          @pick="onPick"
        />
        <div class="zoom">
          <button type="button" :aria-label="t('zoom.in')" @click="zoomBy(1.4)">
            <svg class="ic" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 3v10M3 8h10"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
          </button>
          <button type="button" :aria-label="t('zoom.out')" @click="zoomBy(1 / 1.4)">
            <svg class="ic" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            </svg>
          </button>
          <button type="button" :aria-label="t('reference.fitToView')" @click="fit()">
            <svg class="ic" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            :aria-label="t('reference.aim')"
            :title="t('reference.aim')"
            :aria-pressed="aiming"
            @click="aiming = !aiming"
          >
            <svg class="ic" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="3.1" stroke="currentColor" stroke-width="1.4" />
              <path
                d="M8 1.4v2.5M8 12.1v2.5M1.4 8h2.5M12.1 8h2.5"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
        <RouterLink
          to="/legal#credits"
          class="caption"
          :title="t('reference.credits')"
          target="_blank"
          rel="noopener"
        >
          {{ manifest.name }}
        </RouterLink>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  /* One uniform value on all four sides, so the gap around the window is equal
     left/right and top/bottom. The top adds the 52px TopBar height instead of
     insetting the backdrop: the overlay covers the whole viewport, so nothing
     behind it stays clickable, while the window still centers in the play
     zone below the bar. */
  padding: clamp(24px, 5vmin, 56px);
  padding-top: calc(52px + clamp(24px, 5vmin, 56px));
  /* Room for the caption, which hangs below the shell rather than inside it. */
  padding-bottom: calc(10px + clamp(24px, 5vmin, 56px));
  background: rgba(21, 20, 15, 0.6);
  backdrop-filter: blur(2px);
  /* Size container so the shell can compute the largest image-ratio box that
     fits the padded play zone, using cqw/cqh below. */
  container-type: size;
}
.shell {
  position: relative;
  /* Hug the reference image: the largest box at the image aspect ratio that
     fits both the available width and height, so there are no empty side bands. */
  aspect-ratio: var(--ar);
  width: min(100cqw, calc(100cqh * var(--ar)));
  height: auto;
  max-width: 100%;
  max-height: 100%;
  /* No overflow clip here: the caption is anchored just below the shell and must
     escape it. The image clip lives on .osd-large instead. */
}
.osd-large {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--ground-2);
  box-shadow: var(--shadow-panel);
}
.caption {
  position: absolute;
  top: calc(100% + 9px);
  left: 2px;
  max-width: 100%;
  margin: 0;
  font-family: var(--serif);
  font-size: 14px;
  line-height: 1.2;
  color: var(--ground);
  text-decoration: none;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.caption:hover,
.caption:focus-visible {
  text-decoration: underline;
}
.close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  font-size: 22px;
  line-height: 1;
  color: var(--ink-2);
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid var(--line);
  border-radius: 50%;
  box-shadow: var(--shadow-panel);
}
.close:hover {
  color: var(--ink);
}
.zoom {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  border: 1px solid var(--line);
  border-radius: 12px;
}
.zoom button {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  border-bottom: 1px solid var(--line-2);
}
/* The hover and armed fills reach the pillar's own corners, so the end buttons
   carry its radius rather than painting a square over it. */
.zoom button:first-child {
  border-radius: 12px 12px 0 0;
}
.zoom button:last-child {
  border-bottom: none;
  border-radius: 0 0 12px 12px;
}
.zoom button:hover {
  background: var(--paper-2);
}
.zoom button[aria-pressed="true"] {
  color: var(--accent);
  background: var(--accent-soft);
}
.ic {
  width: 16px;
  height: 16px;
  display: block;
}
</style>
