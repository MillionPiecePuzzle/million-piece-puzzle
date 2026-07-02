<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import BrandMark from "./BrandMark.vue";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { formatCountdown } from "../composables/useCountdown";
import { useAuth } from "../composables/useAuth";
import { useOptionsModal } from "../composables/useOptionsModal";
import { useLocaleFormat } from "../i18n/format";
import { flagUrl } from "../data/flags";

const { t } = useI18n();
const { formatNumber } = useLocaleFormat();
const { eventStartsAt, totalPieces, lockedCount } = usePuzzleSession();
const { user } = useAuth();
const { show: showOptions } = useOptionsModal();

const progressPct = computed(() =>
  totalPieces.value > 0 ? (lockedCount.value / totalPieces.value) * 100 : 0,
);

const now = ref(Date.now());
const ticker = setInterval(() => {
  now.value = Date.now();
}, 1000);
onUnmounted(() => clearInterval(ticker));

// Elapsed since the event started, ticking each second. Null until a real start
// has been reached (no schedule or a future start has no play time to show yet).
const playTime = computed(() => {
  if (eventStartsAt.value <= 0 || now.value < eventStartsAt.value) return null;
  const { days, hours, minutes, seconds } = formatCountdown(now.value - eventStartsAt.value);
  const clock = `${hours}:${minutes}:${seconds}`;
  return Number(days) > 0 ? `${Number(days)}${t("units.d")} ${clock}` : clock;
});
</script>

<template>
  <header class="topbar">
    <RouterLink to="/" class="brand">
      <BrandMark />
      <span class="brand-name">Million Piece <em>Puzzle</em></span>
      <span v-if="playTime" class="brand-caption" :title="t('topbar.playTime')">{{
        playTime
      }}</span>
    </RouterLink>

    <div v-if="totalPieces > 0" class="progress-pill" :title="t('topbar.puzzleProgress')">
      <div class="bar">
        <div class="fill" :style="{ width: `${progressPct}%` }"></div>
      </div>
      <span class="num">
        {{ formatNumber(lockedCount) }}<span> / {{ formatNumber(totalPieces) }}</span>
      </span>
    </div>
    <span v-else></span>

    <div class="top-right">
      <div v-if="user && user.pseudo" class="presence">
        <span class="dot" :title="t('topbar.connected')" :aria-label="t('topbar.connected')"></span>
        <span
          v-if="user.country"
          class="flag"
          :title="t('topbar.nationalityTitle', { code: user.country.toUpperCase() })"
        >
          <img :src="flagUrl(user.country)" :alt="user.country" width="18" height="18" />
        </span>
        <span class="pseudo" :title="t('topbar.signedInAs', { pseudo: user.pseudo })">
          {{ user.pseudo }}
        </span>
        <button
          type="button"
          class="gear"
          :title="t('topbar.options')"
          :aria-label="t('topbar.options')"
          @click="showOptions"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3.2" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  position: fixed;
  inset: 0 0 auto 0;
  height: 52px;
  z-index: 40;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 16px;
  background: rgba(244, 241, 234, 0.85);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line);
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.brand-name {
  font-family: var(--serif);
  font-weight: 500;
  font-size: 18px;
  letter-spacing: -0.01em;
}
.brand-name em {
  font-style: italic;
  font-weight: 400;
  color: var(--ink-3);
}
.brand-caption {
  margin-left: 10px;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--ink-4);
}
.progress-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px 6px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--paper);
}
.progress-pill .bar {
  width: 140px;
  height: 5px;
  border-radius: 99px;
  background: var(--ground-2);
  overflow: hidden;
}
.progress-pill .fill {
  height: 100%;
  background: var(--ink);
  border-radius: 99px;
  transition: width 400ms ease-out;
}
.progress-pill .num {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.progress-pill .num span {
  color: var(--ink-3);
}
.top-right {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 14px;
}
.presence {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--paper);
}
.presence .dot {
  width: 8px;
  height: 8px;
  border-radius: 99px;
  background: #2ecc71;
  box-shadow: 0 0 0 3px rgba(46, 204, 113, 0.2);
}
.presence .flag {
  display: inline-flex;
  border-radius: 50%;
  line-height: 0;
}
.presence .flag img {
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(21, 20, 15, 0.12);
}
.presence .pseudo {
  font-size: 13px;
  letter-spacing: -0.005em;
  color: var(--ink);
}
.presence .gear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: -4px -6px -4px 0;
  border-radius: var(--radius-pill);
  color: var(--ink-3);
  cursor: pointer;
  transition:
    background 160ms ease,
    color 160ms ease;
}
.presence .gear:hover {
  background: var(--ground-2);
  color: var(--ink);
}
</style>
