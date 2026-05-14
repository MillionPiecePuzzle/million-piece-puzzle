<script setup lang="ts">
import type { LeaderboardRow } from "../data/leaderboardMock";

const props = withDefaults(defineProps<{ row: LeaderboardRow; rankWidth?: string }>(), {
  rankWidth: "22px",
});

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
</script>

<template>
  <li
    class="lb-row"
    :class="{ you: props.row.you }"
    :style="{ gridTemplateColumns: `${props.rankWidth} 22px 1fr auto` }"
  >
    <span class="rk" :class="{ top: props.row.rank <= 3 }">{{ props.row.rank }}</span>
    <span class="av" :style="{ background: props.row.color }">{{ props.row.initials }}</span>
    <span class="nm">
      {{ props.row.name }}
      <span v-if="props.row.you" class="you-tag">you</span>
      <span v-else-if="props.row.online" class="live-dot" title="online"></span>
    </span>
    <span class="pc">{{ fmt(props.row.pieces) }}<small> pcs</small></span>
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
</style>
