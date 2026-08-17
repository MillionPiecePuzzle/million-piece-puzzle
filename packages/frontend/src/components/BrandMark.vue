<script setup lang="ts">
import { computed } from "vue";

// Matches public/brand-mark.png (1219x1001), the source composited onto every
// icon by scripts/generate-icons.ts. Keep in sync if that asset is replaced.
const ASPECT_RATIO = 1219 / 1001;

const props = defineProps<{ size?: number }>();
const height = computed(() => props.size ?? 22);
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
