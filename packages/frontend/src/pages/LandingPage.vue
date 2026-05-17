<script setup lang="ts">
import { useRouter } from "vue-router";
import BrandMark from "../components/BrandMark.vue";
import { useMode } from "../composables/useMode";

const router = useRouter();
const { setMode } = useMode();

function enterAsSpectator() {
  setMode("spectator");
  router.push("/play");
}
</script>

<template>
  <div class="landing">
    <header class="landing-top">
      <span class="brand">
        <BrandMark />
        <span class="brand-name">Million Piece <em>Puzzle</em></span>
      </span>
    </header>

    <main class="hero">
      <h1>Million Piece Puzzle</h1>
      <p class="tagline">A community puzzle, one million pieces, one canvas.</p>

      <div class="ctas">
        <button class="cta primary" @click="enterAsSpectator">Enter the canvas</button>
      </div>
    </main>

    <footer class="landing-foot">
      <span>Phase 0 · Local MVP</span>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  min-height: 100%;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: radial-gradient(circle at 50% 35%, #faf7f0 0%, #efeadd 70%, #e7e1d1 100%);
}
.landing-top {
  padding: 20px 24px;
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
.hero {
  align-self: center;
  justify-self: center;
  max-width: 640px;
  padding: 0 24px;
  text-align: center;
}
h1 {
  margin: 0 0 12px;
  font-family: var(--serif);
  font-weight: 500;
  font-size: clamp(40px, 6vw, 64px);
  line-height: 1.05;
  letter-spacing: -0.02em;
}
.tagline {
  margin: 0 0 32px;
  color: var(--ink-3);
  font-size: 14px;
  line-height: 1.5;
}
.ctas {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}
.cta {
  padding: 12px 22px;
  border-radius: var(--radius-pill);
  font-size: 14px;
  letter-spacing: -0.005em;
  border: 1px solid var(--line);
  transition:
    background 160ms ease,
    color 160ms ease;
}
.cta.primary {
  background: var(--ink);
  color: var(--ground);
  border-color: var(--ink);
}
.cta.primary:hover {
  background: var(--ink-2);
}
.cta.ghost {
  background: var(--paper);
  color: var(--ink);
}
.cta.ghost:hover {
  background: var(--paper-2);
}
.landing-foot {
  padding: 20px 24px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
</style>
