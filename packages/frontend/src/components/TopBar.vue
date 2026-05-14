<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import BrandMark from "./BrandMark.vue";
import ModeToggle from "./ModeToggle.vue";
import { useAuthModal } from "../composables/useAuthModal";
import { usePuzzleSession } from "../composables/usePuzzleSession";

const { show } = useAuthModal();
const { puzzleName, totalPieces, lockedCount } = usePuzzleSession();

const progressPct = computed(() =>
  totalPieces.value > 0 ? (lockedCount.value / totalPieces.value) * 100 : 0,
);
</script>

<template>
  <header class="topbar">
    <RouterLink to="/" class="brand">
      <BrandMark />
      <span class="brand-name">Million Piece <em>Puzzle</em></span>
      <span v-if="puzzleName" class="brand-caption">{{ puzzleName }}</span>
    </RouterLink>

    <div v-if="totalPieces > 0" class="progress-pill" title="Puzzle progress">
      <div class="bar">
        <div class="fill" :style="{ width: `${progressPct}%` }"></div>
      </div>
      <span class="num">
        {{ lockedCount.toLocaleString() }}<span> / {{ totalPieces.toLocaleString() }}</span>
      </span>
    </div>
    <span v-else></span>

    <div class="top-right">
      <ModeToggle />
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
.brand-caption {
  margin-left: 10px;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--ink-4);
}
.progress-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px 6px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--paper);
}
.progress-pill .bar {
  width: 140px;
  height: 5px;
  border-radius: 99px;
  background: var(--ground-2);
  overflow: hidden;
}
.progress-pill .fill {
  height: 100%;
  background: var(--ink);
  border-radius: 99px;
  transition: width 400ms ease-out;
}
.progress-pill .num {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.progress-pill .num span {
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
