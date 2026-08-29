<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { COUNTRIES, INTERNATIONAL, PROFILE_COOLDOWN_MS } from "@mpp/shared";
import { useNationalityModal } from "../composables/useNationalityModal";
import { usePseudoModal } from "../composables/usePseudoModal";
import { useAuth } from "../composables/useAuth";
import { useMode } from "../composables/useMode";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useBackdropClick } from "../composables/useBackdropClick";
import { useCountryNames } from "../i18n/countryNames";
import { flagUrl } from "../data/flags";

const { t } = useI18n();
const { countryName, localeTag } = useCountryNames();
const { open, mode, hide } = useNationalityModal();
const { show: showPseudo } = usePseudoModal();
const { user, submitCountry, createGuest, guestPseudo } = useAuth();
const { setMode } = useMode();

// Ordered on the localized label rather than on the dataset's English order,
// which no longer matches what the list reads: "Germany" is "Allemagne" in
// French and belongs at the top there, not between Georgia and Ghana.
const options = computed(() => {
  const collator = new Intl.Collator(localeTag.value);
  return COUNTRIES.map((c) => ({ code: c.code, label: countryName(c.code) })).sort((a, b) =>
    collator.compare(a.label, b.label),
  );
});

const draft = ref("");
const error = ref<string | null>(null);
const saving = ref(false);
const selectEl = ref<HTMLSelectElement | null>(null);
const shellEl = ref<HTMLElement | null>(null);

const previewLabel = computed(() =>
  draft.value ? countryName(draft.value) : t("nationality.noCountry"),
);
const valid = computed(() => draft.value !== "");
const dismissible = computed(() => mode.value === "edit");
// Onboarding (guest or forced) has no existing country to fall back on, so it
// cannot be dismissed, but it can be skipped: skip() fills the draft with the
// international code and runs the normal save path.
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

// Whole hours remaining until retryAt, never below 1 while still on cooldown.
function retryHours(retryAt: number): number {
  return Math.max(1, Math.ceil((retryAt - Date.now()) / 3_600_000));
}

const title = computed(() =>
  mode.value === "edit" ? t("nationality.titleEdit") : t("nationality.titleNew"),
);
const lede = computed(() =>
  mode.value === "edit" ? t("nationality.ledeEdit") : t("nationality.ledeNew"),
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  draft.value = mode.value === "edit" ? (user.value?.country ?? "") : "";
  error.value = null;
  void nextTick(() => selectEl.value?.focus());
});

async function save() {
  const code = draft.value;
  if (code === "" || saving.value) return;
  saving.value = true;
  error.value = null;
  // Guest onboarding: mint the guest from the captured pseudo + this country. A
  // taken pseudo (409) sends the player back to the pseudo step with the error
  // shown; createGuest sets contributor mode, which is what connects the canvas.
  if (mode.value === "guest") {
    const res = await createGuest(guestPseudo.value ?? "", code);
    saving.value = false;
    if (!res.ok) {
      if (res.reason === "taken") {
        hide();
        showPseudo("guest", { error: "pseudo.taken" });
        return;
      }
      error.value = t("common.saveError");
      return;
    }
    hide();
    return;
  }
  const res = await submitCountry(code);
  saving.value = false;
  if (!res.ok) {
    error.value =
      res.reason === "cooldown"
        ? t("nationality.cooldown", { hours: retryHours(res.retryAt) })
        : t("common.saveError");
    return;
  }
  // The nationality step completes onboarding and unlocks contribution.
  if (mode.value === "forced") setMode("contributor");
  hide();
}

// Fills the draft with the international code and runs the same save path a
// chosen country would: guest mints the account, forced submits immediately.
function skip() {
  if (saving.value) return;
  draft.value = INTERNATIONAL.code;
  void save();
}

function onBackdrop() {
  if (dismissible.value) hide();
}

const { onMousedown, onClick } = useBackdropClick(onBackdrop);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop nat-backdrop" @mousedown="onMousedown" @click="onClick">
      <div
        ref="shellEl"
        class="modal-shell nat-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nat-title"
      >
        <header class="modal-header">
          <h2 id="nat-title" class="modal-title">{{ title }}</h2>
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

        <div class="picker">
          <img
            class="preview"
            :src="flagUrl(draft || null)"
            :alt="previewLabel"
            :title="previewLabel"
            width="28"
            height="28"
          />
          <select
            ref="selectEl"
            v-model="draft"
            class="field"
            :aria-label="t('nationality.selectLabel')"
            @keyup.enter="save"
          >
            <option value="" disabled>{{ t("nationality.selectPlaceholder") }}</option>
            <option :value="INTERNATIONAL.code">{{ t("nationality.international") }}</option>
            <option v-for="c in options" :key="c.code" :value="c.code">
              {{ c.label }}
            </option>
          </select>
        </div>

        <p v-if="mode === 'edit'" class="hint">
          {{ t("nationality.cooldownHint", { hours: cooldownHours }) }}
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
.nat-backdrop {
  z-index: 111;
}
.nat-modal {
  width: min(380px, 100%);
}
.picker {
  display: flex;
  align-items: center;
  gap: 10px;
}
.preview {
  flex: none;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(21, 20, 15, 0.12);
}
.field {
  flex: 1;
  min-width: 0;
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
  margin: 10px 0 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
.error {
  margin: 12px 0 0;
  font-family: var(--mono);
  font-size: 12px;
  color: oklch(0.55 0.18 30);
}
.save {
  width: 100%;
  margin-top: 16px;
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
