<script setup lang="ts">
import { watch } from "vue";
import { useAuthModal } from "../composables/useAuthModal";
import { usePseudoModal } from "../composables/usePseudoModal";
import { usePseudo } from "../composables/usePseudo";
import { useAuth } from "../composables/useAuth";
import { usePuzzleSession } from "../composables/usePuzzleSession";

const { open, hide } = useAuthModal();
const { show: showPseudoModal } = usePseudoModal();
const { pseudo } = usePseudo();
const { completeSignIn } = useAuth();
const { completed } = usePuzzleSession();

// A finished puzzle has no contributor entry point: close the modal if it is
// open when completion lands and keep it from rendering afterwards.
watch(completed, (done) => {
  if (done) hide();
});

function continueWithGoogle() {
  hide();
  // A returning contributor already has a pseudo: go straight in. A first-time
  // contributor must pick one through the forced pseudo modal.
  if (pseudo.value) {
    completeSignIn();
  } else {
    showPseudoModal("forced");
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open && !completed" class="auth-backdrop" @click.self="hide">
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
          <button class="provider google" @click="continueWithGoogle">
            <span class="g-mark" aria-hidden="true">G</span>
            Continue with Google
          </button>
        </div>

        <p class="note">Mock sign-in. Auth providers come later.</p>
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
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--paper);
  font-size: 14px;
  text-align: left;
  transition: background 160ms ease;
}
.provider:hover {
  background: var(--paper-2);
}
.provider .g-mark {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 99px;
  background: #fff;
  border: 1px solid var(--line);
  font-family: var(--serif);
  font-weight: 600;
  font-size: 13px;
  color: #4285f4;
}
.note {
  margin: 14px 0 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
  text-align: center;
}
</style>
