<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { LeaderboardRow } from "../data/leaderboard";
import { useLocaleFormat } from "../i18n/format";
import { useCountryNames } from "../i18n/countryNames";
import { flagUrl } from "../data/flags";

const props = withDefaults(
  defineProps<{ row: LeaderboardRow; rankWidth?: string; showYouTag?: boolean }>(),
  {
    rankWidth: "22px",
    showYouTag: true,
  },
);

const { t } = useI18n();
const { formatNumber } = useLocaleFormat();
const { countryName } = useCountryNames();
</script>

<template>
  <li
    class="lb-row"
    :class="{ you: props.row.you }"
    :style="{ gridTemplateColumns: `${props.rankWidth} var(--av-w, 22px) 1fr auto` }"
  >
    <span class="rk" :class="{ top: props.row.rank <= 3 }">{{ props.row.rank }}</span>
    <img
      v-if="props.row.country"
      class="av av-flag"
      :src="flagUrl(props.row.country)"
      :alt="countryName(props.row.country)"
      :title="countryName(props.row.country)"
      width="22"
      height="22"
    />
    <span v-else class="av" :style="{ background: props.row.color }">{{ props.row.initials }}</span>
    <span class="nm">
      <span class="nm-text">{{ props.row.name }}</span>
      <span v-if="props.row.you && props.showYouTag" class="you-tag">{{ t("row.you") }}</span>
      <span v-else-if="props.row.online" class="live-dot" :title="t('row.online')"></span>
    </span>
    <span class="pc"
      >{{ formatNumber(props.row.pieces) }}<small> {{ t("row.pcs") }}</small></span
    >
  </li>
</template>

<style scoped>
.lb-row {
  display: grid;
  align-items: center;
  gap: 10px;
  padding: 7px 6px;
  border-radius: var(--radius-row);
}
.lb-row.you {
  background: rgba(213, 135, 90, 0.1);
  outline: 1px solid rgba(213, 135, 90, 0.25);
}
.rk {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
  text-align: right;
}
.rk.top {
  color: var(--ink);
}
.av {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  color: #fff;
}
.av-flag {
  object-fit: cover;
  box-shadow: inset 0 0 0 1px rgba(21, 20, 15, 0.12);
}
.nm {
  font-size: 13px;
  letter-spacing: -0.005em;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.you-tag {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  background: var(--accent);
  color: #fff;
  padding: 1px 5px;
  border-radius: 3px;
}
.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #34a853;
}
.pc {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}
.pc small {
  color: var(--ink-4);
}

@media (max-width: 680px) {
  .lb-row {
    --av-w: 18px;
    gap: 6px;
    padding: 6px 5px;
  }
  .av {
    width: 18px;
    height: 18px;
    font-size: 9px;
  }
  .nm-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
}
</style>
