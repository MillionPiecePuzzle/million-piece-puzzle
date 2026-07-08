<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  PROFILE_COOLDOWN_MS,
  PSEUDO_MAX_LENGTH,
  PSEUDO_MIN_LENGTH,
  normalizePseudo,
} from "@mpp/shared";
import { usePseudoModal } from "../composables/usePseudoModal";
import { useNationalityModal } from "../composables/useNationalityModal";
import { useAuth } from "../composables/useAuth";

const { t } = useI18n();
const { open, mode, initialError, hide } = usePseudoModal();
const { show: showNationality } = useNationalityModal();
const { user, submitPseudo, setGuestPseudo } = useAuth();

const draft = ref("");
const error = ref<string | null>(null);
const saving = ref(false);
const inputEl = ref<HTMLInputElement | null>(null);

const normalized = computed(() => normalizePseudo(draft.value));
const valid = computed(() => normalized.value !== null);
const dismissible = computed(() => mode.value === "edit");
const cooldownHours = PROFILE_COOLDOWN_MS / 3_600_000;

const title = computed(() =>
  mode.value === "edit" ? t("pseudo.titleEdit") : t("pseudo.titleNew"),
);
const lede = computed(() => (mode.value === "edit" ? t("pseudo.ledeEdit") : t("pseudo.ledeNew")));

watch(open, (isOpen) => {
  if (!isOpen) return;
  draft.value = mode.value === "edit" ? (user.value?.pseudo ?? "") : "";
  error.value = initialError.value ? t(initialError.value) : null;
  void nextTick(() => inputEl.value?.focus());
});

// Whole hours remaining until retryAt, never below 1 while still on cooldown.
function retryHours(retryAt: number): number {
  return Math.max(1, Math.ceil((retryAt - Date.now()) / 3_600_000));
}

async function save() {
  const name = normalized.value;
  if (name === null || saving.value) return;
  // Guest onboarding: no session yet, so just capture the pseudo and advance to
  // the country step, which mints via POST /guest. Uniqueness is enforced there.
  if (mode.value === "guest") {
    setGuestPseudo(name);
    hide();
    showNationality("guest");
    return;
  }
  saving.value = true;
  error.value = null;
  const res = await submitPseudo(name);
  saving.value = false;
  if (!res.ok) {
    if (res.reason === "taken") error.value = t("pseudo.taken");
    else if (res.reason === "cooldown")
      error.value = t("pseudo.cooldown", { hours: retryHours(res.retryAt) });
    else error.value = t("common.saveError");
    return;
  }
  // First-time onboarding chains into the required nationality step, which is
  // what actually unlocks contribution. An edit just updates the name.
  if (mode.value === "forced") showNationality("forced");
  hide();
}

function onBackdrop() {
  if (dismissible.value) hide();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop pseudo-backdrop" @click.self="onBackdrop">
      <div
        class="modal-shell pseudo-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pseudo-title"
      >
        <header class="modal-header">
          <h2 id="pseudo-title" class="modal-title">{{ title }}</h2>
          <button
            v-if="dismissible"
            class="modal-close"
            :aria-label="t('common.close')"
            @click="hide"
          >
            ×
          </button>
        </header>

        <p class="modal-lede">{{ lede }}</p>

        <input
          ref="inputEl"
          v-model="draft"
          class="field"
          type="text"
          :maxlength="PSEUDO_MAX_LENGTH"
          :placeholder="t('pseudo.placeholder')"
          :aria-label="t('pseudo.fieldLabel')"
          autocomplete="off"
          @keyup.enter="save"
        />
        <p class="hint">
          {{ t("pseudo.hint", { min: PSEUDO_MIN_LENGTH, max: PSEUDO_MAX_LENGTH }) }}
        </p>
        <p v-if="mode === 'edit'" class="hint">
          {{ t("pseudo.cooldownHint", { hours: cooldownHours }) }}
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <button class="save" :disabled="!valid || saving" @click="save">
          {{ saving ? t("common.saving") : t("common.save") }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pseudo-backdrop {
  z-index: 110;
}
.pseudo-modal {
  width: min(380px, calc(100vw - 32px));
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
.error {
  margin: -6px 0 12px;
  font-family: var(--mono);
  font-size: 12px;
  color: oklch(0.55 0.18 30);
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
