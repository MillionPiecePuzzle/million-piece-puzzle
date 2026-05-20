<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { PSEUDO_MAX_LENGTH, PSEUDO_MIN_LENGTH, normalizePseudo } from "@mpp/shared";
import { usePseudoModal } from "../composables/usePseudoModal";
import { usePseudo } from "../composables/usePseudo";
import { useAuth } from "../composables/useAuth";
import { usePuzzleSession } from "../composables/usePuzzleSession";

const { open, mode, hide } = usePseudoModal();
const { pseudo, setPseudo } = usePseudo();
const { completeSignIn } = useAuth();
const { sendSetPseudo } = usePuzzleSession();

const draft = ref("");
const inputEl = ref<HTMLInputElement | null>(null);

const normalized = computed(() => normalizePseudo(draft.value));
const valid = computed(() => normalized.value !== null);
const dismissible = computed(() => mode.value === "edit");

const title = computed(() => (mode.value === "edit" ? "Change your pseudo" : "Choose your pseudo"));
const lede = computed(() =>
  mode.value === "edit"
    ? "Pick a new pseudo. It is shown to other builders next to the pieces you place."
    : "Pick a pseudo before you start placing pieces. It is shown to other builders.",
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  draft.value = mode.value === "edit" ? (pseudo.value ?? "") : "";
  void nextTick(() => inputEl.value?.focus());
});

function save() {
  const name = normalized.value;
  if (name === null) return;
  setPseudo(name);
  sendSetPseudo(name);
  if (mode.value === "forced") completeSignIn();
  hide();
}

function onBackdrop() {
  if (dismissible.value) hide();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="pseudo-backdrop" @click.self="onBackdrop">
      <div class="pseudo-modal" role="dialog" aria-modal="true" aria-labelledby="pseudo-title">
        <header>
          <h2 id="pseudo-title">{{ title }}</h2>
          <button v-if="dismissible" class="close" aria-label="Close" @click="hide">×</button>
        </header>

        <p class="lede">{{ lede }}</p>

        <input
          ref="inputEl"
          v-model="draft"
          class="field"
          type="text"
          :maxlength="PSEUDO_MAX_LENGTH"
          placeholder="your pseudo"
          aria-label="Pseudo"
          autocomplete="off"
          @keyup.enter="save"
        />
        <p class="hint">
          {{ PSEUDO_MIN_LENGTH }} to {{ PSEUDO_MAX_LENGTH }} characters: letters, digits, spaces,
          hyphens and underscores.
        </p>

        <button class="save" :disabled="!valid" @click="save">Save</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pseudo-backdrop {
  position: fixed;
  inset: 0;
  z-index: 110;
  background: rgba(21, 20, 15, 0.35);
  backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
}
.pseudo-modal {
  width: min(380px, calc(100vw - 32px));
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
.field {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--paper);
  font-size: 14px;
  color: var(--ink);
}
.field:focus {
  outline: none;
  border-color: var(--ink-3);
}
.hint {
  margin: 8px 0 14px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
.save {
  width: 100%;
  padding: 10px 14px;
  border-radius: var(--radius-btn);
  border: 1px solid var(--ink);
  background: var(--ink);
  color: var(--ground);
  font-size: 14px;
  transition:
    background 160ms ease,
    opacity 160ms ease;
}
.save:hover:not(:disabled) {
  background: var(--ink-2);
}
.save:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
