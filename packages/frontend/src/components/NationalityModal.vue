<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { COUNTRIES, PROFILE_COOLDOWN_MS } from "@mpp/shared";
import { useNationalityModal } from "../composables/useNationalityModal";
import { usePseudoModal } from "../composables/usePseudoModal";
import { useAuth } from "../composables/useAuth";
import { useMode } from "../composables/useMode";
import { LOCALE_TAGS, type AppLocale } from "../i18n";
import { flagUrl } from "../data/flags";

const { t, locale } = useI18n();
const { open, mode, hide } = useNationalityModal();
const { show: showPseudo } = usePseudoModal();
const { user, submitCountry, createGuest, guestPseudo } = useAuth();
const { setMode } = useMode();

// Localize country labels from their code, falling back to the dataset's English
// name for any code Intl does not recognize as a region.
const regionNames = computed(() => {
  try {
    return new Intl.DisplayNames([LOCALE_TAGS[locale.value as AppLocale]], { type: "region" });
  } catch {
    return null;
  }
});
function countryName(country: { code: string; name: string }): string {
  try {
    return regionNames.value?.of(country.code.toUpperCase()) ?? country.name;
  } catch {
    return country.name;
  }
}

const draft = ref("");
const error = ref<string | null>(null);
const saving = ref(false);
const selectEl = ref<HTMLSelectElement | null>(null);

const valid = computed(() => draft.value !== "");
const dismissible = computed(() => mode.value === "edit");
const cooldownHours = PROFILE_COOLDOWN_MS / 3_600_000;

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

function onBackdrop() {
  if (dismissible.value) hide();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="nat-backdrop" @click.self="onBackdrop">
      <div class="nat-modal" role="dialog" aria-modal="true" aria-labelledby="nat-title">
        <header>
          <h2 id="nat-title">{{ title }}</h2>
          <button v-if="dismissible" class="close" :aria-label="t('common.close')" @click="hide">
            ×
          </button>
        </header>

        <p class="lede">{{ lede }}</p>

        <div class="picker">
          <img
            class="preview"
            :src="flagUrl(draft || null)"
            :alt="draft || t('nationality.noCountry')"
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
            <option v-for="c in COUNTRIES" :key="c.code" :value="c.code">
              {{ countryName(c) }}
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
  position: fixed;
  inset: 0;
  z-index: 111;
  background: rgba(21, 20, 15, 0.35);
  backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
}
.nat-modal {
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
