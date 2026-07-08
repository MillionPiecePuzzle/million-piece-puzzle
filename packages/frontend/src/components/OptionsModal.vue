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
