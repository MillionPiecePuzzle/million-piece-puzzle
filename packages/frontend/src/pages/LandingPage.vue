<script setup lang="ts">
import { nextTick, ref } from "vue";
import { useRouter } from "vue-router";
import BrandMark from "../components/BrandMark.vue";
import { useMode } from "../composables/useMode";
import { tryUnlockAlpha } from "../composables/useAlphaGate";

const router = useRouter();
const { setMode } = useMode();

const passcode = ref("");
const errorMessage = ref<string | null>(null);
const submitting = ref(false);
const modalOpen = ref(false);
const passcodeInput = ref<HTMLInputElement | null>(null);

async function openModal(): Promise<void> {
  modalOpen.value = true;
  errorMessage.value = null;
  await nextTick();
  passcodeInput.value?.focus();
}

function closeModal(): void {
  modalOpen.value = false;
  submitting.value = false;
  passcode.value = "";
  errorMessage.value = null;
}

function submitPasscode(): void {
  errorMessage.value = null;
  submitting.value = true;
  if (!tryUnlockAlpha(passcode.value)) {
    errorMessage.value = "Wrong passcode.";
    submitting.value = false;
    return;
  }
  setMode("spectator");
  void router.push("/play");
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

      <button type="button" class="cta primary" @click="openModal">Enter the canvas</button>
    </main>

    <footer class="landing-foot">
      <span>Phase 1 · Closed Alpha</span>
    </footer>

    <Transition name="modal">
      <div
        v-if="modalOpen"
        class="modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="alpha-modal-title"
        @click.self="closeModal"
        @keydown.esc="closeModal"
      >
        <div class="modal">
          <button
            type="button"
            class="modal-close"
            aria-label="Close"
            @click="closeModal"
          >
            ×
          </button>
          <p id="alpha-modal-title" class="modal-title">Alpha passcode</p>
          <form class="modal-form" @submit.prevent="submitPasscode">
            <input
              ref="passcodeInput"
              v-model="passcode"
              type="password"
              autocomplete="off"
              class="passcode"
              placeholder="Passcode"
              aria-label="Alpha passcode"
            />
            <button class="cta primary" type="submit" :disabled="submitting">Enter</button>
          </form>
          <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
          <p class="alpha-note">Closed alpha. Passcode required.</p>
        </div>
      </div>
    </Transition>
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
.cta {
  padding: 12px 22px;
  border-radius: var(--radius-pill);
  font-size: 14px;
  letter-spacing: -0.005em;
  border: 1px solid var(--line);
  transition:
    background 160ms ease,
    color 160ms ease;
  cursor: pointer;
}
.cta.primary {
  background: var(--ink);
  color: var(--ground);
  border-color: var(--ink);
}
.cta.primary:hover {
  background: var(--ink-2);
}
.cta.primary:disabled {
  opacity: 0.6;
  cursor: default;
}
.landing-foot {
  padding: 20px 24px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(21, 20, 15, 0.32);
  backdrop-filter: blur(4px);
  z-index: 50;
  padding: 24px;
}
.modal {
  position: relative;
  width: min(420px, 100%);
  padding: 32px 32px 24px;
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  box-shadow: 0 24px 64px rgba(21, 20, 15, 0.24);
  text-align: center;
}
.modal-close {
  position: absolute;
  top: 10px;
  right: 12px;
  appearance: none;
  background: none;
  border: none;
  padding: 4px 8px;
  font-size: 22px;
  line-height: 1;
  color: var(--ink-4);
  cursor: pointer;
  transition: color 150ms ease;
}
.modal-close:hover {
  color: var(--ink);
}
.modal-title {
  margin: 0 0 18px;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.passcode {
  padding: 11px 16px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--line);
  font-size: 14px;
  font-family: var(--mono);
  letter-spacing: 0.02em;
  background: var(--paper);
  color: var(--ink);
  text-align: center;
}
.passcode:focus {
  outline: none;
  border-color: var(--ink-3);
}
.error {
  margin: 14px 0 0;
  font-family: var(--mono);
  font-size: 12px;
  color: oklch(0.55 0.18 30);
}
.alpha-note {
  margin: 18px 0 0;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.modal-enter-active,
.modal-leave-active {
  transition: opacity 180ms ease;
}
.modal-enter-active .modal,
.modal-leave-active .modal {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal,
.modal-leave-to .modal {
  opacity: 0;
  transform: translateY(8px);
}
</style>
