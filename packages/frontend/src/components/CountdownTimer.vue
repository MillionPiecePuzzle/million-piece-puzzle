<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { CountdownParts } from "../composables/useCountdown";

defineProps<{ scheduled: boolean; parts: CountdownParts }>();

const { t } = useI18n();

const PLACEHOLDER = "--";
</script>

<template>
  <div class="countdown" :class="{ pending: !scheduled }" role="timer" aria-live="off">
    <div class="units">
      <div class="unit">
        <span class="value">{{ scheduled ? parts.days : PLACEHOLDER }}</span>
        <span class="label">{{ t("countdown.days") }}</span>
      </div>
      <span class="sep" aria-hidden="true">:</span>
      <div class="unit">
        <span class="value">{{ scheduled ? parts.hours : PLACEHOLDER }}</span>
        <span class="label">{{ t("countdown.hours") }}</span>
      </div>
      <span class="sep" aria-hidden="true">:</span>
      <div class="unit">
        <span class="value">{{ scheduled ? parts.minutes : PLACEHOLDER }}</span>
        <span class="label">{{ t("countdown.minutes") }}</span>
      </div>
      <span class="sep" aria-hidden="true">:</span>
      <div class="unit">
        <span class="value">{{ scheduled ? parts.seconds : PLACEHOLDER }}</span>
        <span class="label">{{ t("countdown.seconds") }}</span>
      </div>
    </div>
    <p v-if="!scheduled" class="caption">{{ t("countdown.launchingSoon") }}</p>
  </div>
</template>

<style scoped>
.countdown {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.units {
  display: flex;
  align-items: flex-start;
  gap: clamp(8px, 2vw, 18px);
  font-family: var(--mono);
}
.unit {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: clamp(56px, 12vw, 104px);
}
.value {
  font-size: clamp(44px, 9vw, 92px);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--ink);
}
.label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.sep {
  font-size: clamp(36px, 7vw, 72px);
  line-height: 1;
  color: var(--ink-4);
  align-self: flex-start;
  margin-top: 0.04em;
}
.caption {
  margin: 0;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.pending .value {
  color: var(--ink-4);
}
</style>
