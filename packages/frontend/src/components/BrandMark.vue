<script setup lang="ts">
defineProps<{ size?: number }>();
</script>

<template>
  <svg
    class="brand-mark"
    :width="size ?? 22"
    :height="size ?? 22"
    viewBox="0 0 22 22"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M3.9,4 L15.1,4 A1.4,1.4 0 0 1 16.5,5.4 L16.5,8 A3,3 0 0 1 16.5,14 L16.5,16.6 A1.4,1.4 0 0 1 15.1,18 L10.6,18 A2.6,2.6 0 0 0 5.4,18 L3.9,18 A1.4,1.4 0 0 1 2.5,16.6 L2.5,5.4 A1.4,1.4 0 0 1 3.9,4 Z"
      fill="#15140f"
    />
  </svg>
</template>
