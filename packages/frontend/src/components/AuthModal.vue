<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthModal } from "../composables/useAuthModal";
import { isAccountAlreadyLinked, useAuth } from "../composables/useAuth";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useBackdropClick } from "../composables/useBackdropClick";
import GoogleMark from "./GoogleMark.vue";

const { t } = useI18n();
const { open, show, hide } = useAuthModal();
const { signIn, authError, clearAuthError, switchToLinkedAccount } = useAuth();

const shellEl = ref<HTMLElement | null>(null);
const trap = useFocusTrap(shellEl, { onEscape: close });
const { onMousedown, onClick } = useBackdropClick(close);
watch(open, (isOpen) => (isOpen ? trap.activate() : trap.deactivate()));

// A refused sign-in comes back as a query flag on /play, so the modal opens
// itself to explain rather than dropping the player back on a silent board.
const switching = computed(() => isAccountAlreadyLinked(authError.value));
const failed = computed(() => authError.value !== null && !switching.value);
watch(authError, (code) => code !== null && show(), { immediate: true });

function close() {
  clearAuthError();
  hide();
}

function proceed() {
  // Both navigate away to Google. The ordinary sync carries the live guest
  // session, so the provider account is linked onto that same guest document,
  // which the server promotes to a permanent account (see the linkAccount event
  // in auth.ts). The switch drops the session first, since Auth.js will not
  // attach an account that already belongs to another profile.
  if (switching.value) void switchToLinkedAccount();
  else void signIn("google");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop auth-backdrop" @mousedown="onMousedown" @click="onClick">
      <div
        ref="shellEl"
        class="modal-shell auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
      >
        <header class="modal-header">
          <h2 id="auth-title" class="modal-title">
            {{ switching ? t("auth.switchTitle") : t("auth.title") }}
          </h2>
          <button class="modal-close" :aria-label="t('common.close')" @click="close">×</button>
        </header>

        <p class="modal-lede">{{ switching ? t("auth.switchLede") : t("auth.lede") }}</p>
        <p v-if="failed" class="error" role="alert">{{ t("auth.signInFailed") }}</p>

        <div class="providers">
          <button class="provider google" @click="proceed">
            <span class="g-mark" aria-hidden="true">
              <GoogleMark :size="14" />
            </span>
            {{ switching ? t("auth.switchAction") : t("auth.continueGoogle") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.auth-backdrop {
  z-index: 100;
}
.auth-modal {
  width: min(420px, calc(100vw - 32px));
}
.error {
  margin: -6px 0 12px;
  font-family: var(--mono);
  font-size: 12px;
  color: oklch(0.55 0.18 30);
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
}
</style>
