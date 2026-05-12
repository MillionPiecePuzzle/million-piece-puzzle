<script setup lang="ts">
import { RouterLink } from "vue-router";
import BrandMark from "./BrandMark.vue";
import ModeToggle from "./ModeToggle.vue";
import { useAuthModal } from "../composables/useAuthModal";

const { show } = useAuthModal();
</script>

<template>
  <header class="topbar">
    <RouterLink to="/" class="brand">
      <BrandMark />
      <span class="brand-name">Million Piece <em>Puzzle</em></span>
    </RouterLink>

    <ModeToggle />

    <div class="top-right">
      <button class="signin" @click="show">Sign in</button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  position: fixed;
  inset: 0 0 auto 0;
  height: 52px;
  z-index: 40;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 16px;
  background: rgba(244, 241, 234, 0.85);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line);
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.brand-name {
  font-family: var(--serif);
  font-weight: 500;
  font-size: 18px;
  letter-spacing: -0.01em;
}
.brand-name em {
  font-style: italic;
  font-weight: 400;
  color: var(--ink-3);
}
.top-right {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 14px;
}
.signin {
  padding: 6px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--paper);
  font-size: 13px;
  letter-spacing: -0.005em;
}
.signin:hover {
  background: var(--paper-2);
}
</style>
