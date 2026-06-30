<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useAuthModal } from "../composables/useAuthModal";
import { useAuth } from "../composables/useAuth";

const { t } = useI18n();
const { open, hide } = useAuthModal();
const { signIn } = useAuth();

function continueWithGoogle() {
  // Navigates away to Google; on return the guest's contributions are claimed
  // into this account and the carried-over pseudo/country skip onboarding (see
  // useAuth.bootstrap).
  void signIn("google");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="auth-backdrop" @click.self="hide">
      <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <header>
          <h2 id="auth-title">{{ t("auth.title") }}</h2>
          <button class="close" :aria-label="t('common.close')" @click="hide">×</button>
        </header>

        <p class="lede">{{ t("auth.lede") }}</p>

        <div class="providers">
          <button class="provider google" @click="continueWithGoogle">
            <span class="g-mark" aria-hidden="true">G</span>
            {{ t("auth.continueGoogle") }}
          </button>
        </div>
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
</style>
