<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useOptionsModal } from "../composables/useOptionsModal";
import { useAuthModal } from "../composables/useAuthModal";
import { usePseudoModal } from "../composables/usePseudoModal";
import { useNationalityModal } from "../composables/useNationalityModal";
import { useAuth } from "../composables/useAuth";

const { t } = useI18n();
const { open, hide } = useOptionsModal();
const { show: showAuth } = useAuthModal();
const { show: showPseudo } = usePseudoModal();
const { show: showNationality } = useNationalityModal();
const { user, signOut } = useAuth();

// Sync hands off to the (confirmation) auth modal; the profile edits reuse the
// existing pseudo/country modals in their dismissible edit mode.
function sync() {
  hide();
  showAuth();
}
function changePseudo() {
  hide();
  showPseudo("edit");
}
function changeCountry() {
  hide();
  showNationality("edit");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="options-backdrop" @click.self="hide">
      <div class="options-modal" role="dialog" aria-modal="true" aria-labelledby="options-title">
        <header>
          <h2 id="options-title">{{ t("options.title") }}</h2>
          <button class="close" :aria-label="t('common.close')" @click="hide">×</button>
        </header>

        <div class="actions">
          <button v-if="user?.guest" type="button" class="action sync" @click="sync">
            <span class="label">{{ t("options.sync") }}</span>
            <span class="hint">{{ t("options.syncHint") }}</span>
          </button>
          <button type="button" class="action" @click="changePseudo">
            <span class="label">{{ t("options.changePseudo") }}</span>
          </button>
          <button type="button" class="action" @click="changeCountry">
            <span class="label">{{ t("options.changeCountry") }}</span>
          </button>
        </div>

        <button type="button" class="signout" @click="signOut">{{ t("options.signOut") }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.options-backdrop {
  position: fixed;
  inset: 0;
  z-index: 109;
  background: rgba(21, 20, 15, 0.35);
  backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
}
.options-modal {
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
  margin-bottom: 14px;
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
.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.action {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--paper);
  text-align: left;
  transition: background 160ms ease;
}
.action:hover {
  background: var(--paper-2);
}
.action .label {
  font-size: 14px;
  color: var(--ink);
}
.action .hint {
  font-size: 12px;
  color: var(--ink-3);
  line-height: 1.4;
}
.action.sync {
  border-color: var(--ink);
}
.signout {
  width: 100%;
  margin-top: 16px;
  padding: 10px 14px;
  border-radius: var(--radius-btn);
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink-3);
  font-size: 14px;
  transition:
    background 160ms ease,
    color 160ms ease;
}
.signout:hover {
  background: var(--ground-2);
  color: var(--ink);
}
</style>
