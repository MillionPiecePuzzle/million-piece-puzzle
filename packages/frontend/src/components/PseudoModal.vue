<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  PROFILE_COOLDOWN_MS,
  PSEUDO_MAX_LENGTH,
  PSEUDO_MIN_LENGTH,
  generateGuestPseudo,
  normalizePseudo,
} from "@mpp/shared";
import { usePseudoModal } from "../composables/usePseudoModal";
import { useNationalityModal } from "../composables/useNationalityModal";
import { useAuth } from "../composables/useAuth";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useBackdropClick } from "../composables/useBackdropClick";
import GoogleMark from "./GoogleMark.vue";

const { t } = useI18n();
const { open, mode, initialError, hide } = usePseudoModal();
const { show: showNationality } = useNationalityModal();
const { user, submitPseudo, setGuestPseudo, signIn } = useAuth();

const draft = ref("");
const error = ref<string | null>(null);
const saving = ref(false);
const inputEl = ref<HTMLInputElement | null>(null);
const shellEl = ref<HTMLElement | null>(null);

const normalized = computed(() => normalizePseudo(draft.value));
const valid = computed(() => normalized.value !== null);
const dismissible = computed(() => mode.value === "edit");
// Onboarding (guest or forced) has no existing pseudo to fall back on, so it
// cannot be dismissed, but it can be skipped: skip() fills the draft with a
// generated pseudo and runs the normal save path.
const skippable = computed(() => mode.value !== "edit");
const cooldownHours = PROFILE_COOLDOWN_MS / 3_600_000;

// Escape must respect dismissible, not skippable: an accidental Esc or
// backdrop click should never silently skip onboarding, only the explicit
// Skip button does (see skip below).
const trap = useFocusTrap(shellEl, {
  onEscape: () => {
    if (dismissible.value) hide();
  },
  autoFocus: false,
});
watch(open, (isOpen) => (isOpen ? trap.activate() : trap.deactivate()));

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

// Fills the draft with a generated pseudo and runs the same save path a typed
// name would: guest chains into the country step, forced submits immediately
// (a rare collision surfaces the ordinary taken-pseudo error, and Skip can
// just be clicked again for a new tag).
function skip() {
  if (saving.value) return;
  draft.value = generateGuestPseudo();
  void save();
}

// The way back into an existing account. Only in guest mode, the one step that
// runs with no session at all: Auth.js finds the profile the Google account is
// linked to and signs straight into it, instead of refusing to attach it to a
// guest this browser has not minted yet.
function signInInstead() {
  void signIn("google");
}

function onBackdrop() {
  if (dismissible.value) hide();
}

const { onMousedown, onClick } = useBackdropClick(onBackdrop);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="modal-backdrop pseudo-backdrop"
      @mousedown="onMousedown"
      @click="onClick"
    >
      <div
        ref="shellEl"
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
          <button v-else-if="skippable" class="modal-skip" :disabled="saving" @click="skip">
            {{ t("common.skip") }}
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

        <button v-if="mode === 'guest'" class="signin" :disabled="saving" @click="signInInstead">
          <GoogleMark :size="16" />
          {{ t("pseudo.haveAccount") }}
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
.signin {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-top: 8px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: transparent;
  color: var(--ink-2);
  font-size: 13px;
  transition: background 160ms ease;
}
.signin:hover:not(:disabled) {
  background: var(--paper-2);
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
