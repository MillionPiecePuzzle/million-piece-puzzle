<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useOptionsModal } from "../composables/useOptionsModal";
import { useAuthModal } from "../composables/useAuthModal";
import { usePseudoModal } from "../composables/usePseudoModal";
import { useNationalityModal } from "../composables/useNationalityModal";
import { useAuth } from "../composables/useAuth";
import { useDynamicLoading } from "../composables/useDynamicLoading";

const { t } = useI18n();
const { open, hide } = useOptionsModal();
const { show: showAuth } = useAuthModal();
const { show: showPseudo } = usePseudoModal();
const { show: showNationality } = useNationalityModal();
const { user, signOut } = useAuth();
const { dynamicLoadingEnabled } = useDynamicLoading();

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
    <div v-if="open" class="modal-backdrop options-backdrop" @click.self="hide">
      <div
        class="modal-shell options-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="options-title"
      >
        <header class="modal-header">
          <h2 id="options-title" class="modal-title">{{ t("options.title") }}</h2>
          <button class="modal-close" :aria-label="t('common.close')" @click="hide">×</button>
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

        <div class="section">
          <p class="section-label">{{ t("options.display") }}</p>
          <label class="toggle">
            <input v-model="dynamicLoadingEnabled" type="checkbox" />
            <span class="toggle-track"><span class="toggle-thumb" /></span>
            <span class="toggle-copy">
              <span class="label">{{ t("options.dynamicLoading") }}</span>
              <span class="hint">{{ t("options.dynamicLoadingHint") }}</span>
            </span>
          </label>
        </div>

        <button type="button" class="signout" @click="signOut">{{ t("options.signOut") }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.options-backdrop {
  z-index: 109;
}
.options-modal {
  width: min(380px, calc(100vw - 32px));
}
.modal-header {
  margin-bottom: 14px;
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
.section {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.section-label {
  margin: 0 0 8px;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  cursor: pointer;
}
.toggle input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}
.toggle-track {
  flex: none;
  width: 34px;
  height: 20px;
  border-radius: var(--radius-pill);
  background: var(--line);
  position: relative;
  transition: background 150ms ease;
}
.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--paper);
  box-shadow: var(--shadow-panel);
  transition: transform 150ms ease;
}
.toggle input:checked + .toggle-track {
  background: var(--accent);
}
.toggle input:checked + .toggle-track .toggle-thumb {
  transform: translateX(14px);
}
.toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}
.toggle-copy .label {
  font-size: 14px;
  color: var(--ink);
}
.toggle-copy .hint {
  font-size: 12px;
  color: var(--ink-3);
  line-height: 1.4;
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
