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
    <path d="M2 2h8v5a2 2 0 0 0 2 2h5v11H2V2zm10 0h8v8h-5a3 3 0 0 1-3-3V2z" fill="#15140f" />
  </svg>
</template>
