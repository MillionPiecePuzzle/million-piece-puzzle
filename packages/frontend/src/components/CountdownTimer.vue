<script setup lang="ts">
import type { CountdownParts } from "../composables/useCountdown";

defineProps<{ scheduled: boolean; parts: CountdownParts }>();

const PLACEHOLDER = "--";
</script>

<template>
  <div class="countdown" :class="{ pending: !scheduled }" role="timer" aria-live="off">
    <div class="units">
      <div class="unit">
        <span class="value">{{ scheduled ? parts.days : PLACEHOLDER }}</span>
      </div>
      <span class="sep" aria-hidden="true">:</span>
      <div class="unit">
        <span class="value">{{ scheduled ? parts.hours : PLACEHOLDER }}</span>
      </div>
      <span class="sep" aria-hidden="true">:</span>
      <div class="unit">
        <span class="value">{{ scheduled ? parts.minutes : PLACEHOLDER }}</span>
      </div>
      <span class="sep" aria-hidden="true">:</span>
      <div class="unit">
        <span class="value">{{ scheduled ? parts.seconds : PLACEHOLDER }}</span>
      </div>
    </div>
    <p class="caption">{{ scheduled ? "Until the canvas opens" : "Launching soon" }}</p>
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
