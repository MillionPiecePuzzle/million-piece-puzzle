<script setup lang="ts">
import { computed } from "vue";

// Matches public/brand-mark.png (1294x949), the source composited onto every
// icon by scripts/generate-icons.ts. Keep in sync if that asset is replaced.
const ASPECT_RATIO = 1294 / 949;

const props = defineProps<{ size?: number }>();
const height = computed(() => props.size ?? 18);
const width = computed(() => Math.round(height.value * ASPECT_RATIO));
</script>

<template>
  <img
    class="brand-mark"
    src="/brand-mark.png"
    :width="width"
    :height="height"
    alt=""
    aria-hidden="true"
  />
</template>

<style scoped>
.brand-mark {
  /* The glyph fills its box edge to edge, but the adjoining wordmark's ink
     sits high in its line box (no descenders in "Million Piece Puzzle"), so
     centering both boxes on their geometry leaves the icon looking low.
     Nudge it up to match the text's optical center. */
  transform: translateY(-2.4px);
}
</style>
