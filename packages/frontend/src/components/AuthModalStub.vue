<script setup lang="ts">
import { useAuthModal } from "../composables/useAuthModal";

const { open, hide } = useAuthModal();

const providers = [
  { id: "google", label: "Continue with Google" },
  { id: "apple", label: "Continue with Apple" },
  { id: "reddit", label: "Continue with Reddit" },
];
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="auth-backdrop" @click.self="hide">
      <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <header>
          <h2 id="auth-title">Become a contributor</h2>
          <button class="close" aria-label="Close" @click="hide">×</button>
        </header>

        <p class="lede">
          Sign in to drop pieces on the canvas under your pseudo. Spectator mode stays open to
          everyone.
        </p>

        <div class="providers">
          <button v-for="p in providers" :key="p.id" class="provider" disabled>
            {{ p.label }}
          </button>
        </div>

        <p class="note">Authentication is not wired up yet.</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.auth-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(21, 20, 15, 0.35);
  backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
}
.auth-modal {
  width: min(420px, calc(100vw - 32px));
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-panel);
  padding: 20px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
h2 {
  margin: 0;
  font-family: var(--serif);
  font-weight: 500;
  font-size: 20px;
  letter-spacing: -0.01em;
}
.close {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-pill);
  color: var(--ink-3);
  font-size: 20px;
  line-height: 1;
}
.close:hover {
  background: var(--ground-2);
  color: var(--ink);
}
.lede {
  margin: 0 0 14px;
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.5;
}
.providers {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.provider {
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--paper);
  font-size: 14px;
  text-align: left;
}
.provider:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.note {
  margin: 14px 0 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
  text-align: center;
}
</style>
