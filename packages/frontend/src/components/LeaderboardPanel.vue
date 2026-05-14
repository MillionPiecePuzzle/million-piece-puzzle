<script setup lang="ts">
import { ref } from "vue";
import { leaderboardPanelRows } from "../data/leaderboardMock";
import LeaderboardModal from "./LeaderboardModal.vue";

const showModal = ref(false);

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
</script>

<template>
  <aside class="panel leaderboard">
    <div class="lb-head">
      <h3>Leaderboard</h3>
    </div>
    <ol class="lb-list">
      <li v-for="row in leaderboardPanelRows" :key="row.rank" :class="{ you: row.you }">
        <span class="rk" :class="{ top: row.rank <= 3 }">{{ row.rank }}</span>
        <span class="av" :style="{ background: row.color }">{{ row.initials }}</span>
        <span class="nm">
          {{ row.name }}
          <span v-if="row.you" class="you-tag">you</span>
          <span v-else-if="row.online" class="live-dot" title="online"></span>
        </span>
        <span class="pc">{{ fmt(row.pieces) }}<small> pcs</small></span>
      </li>
    </ol>
    <div class="lb-foot">
      <button type="button" class="full-board" @click="showModal = true">full board</button>
    </div>
  </aside>

  <LeaderboardModal v-if="showModal" @close="showModal = false" />
</template>

<style scoped>
.leaderboard {
  top: 16px;
  right: 16px;
  width: 288px;
  padding: 14px 14px 10px;
}
.lb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.lb-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.lb-list li {
  display: grid;
  grid-template-columns: 18px 22px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 7px 6px;
  border-radius: var(--radius-row);
}
.lb-list li.you {
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
.lb-foot {
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px dashed var(--line);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  font-family: var(--mono);
  font-size: 11px;
}
.full-board {
  color: var(--ink);
  font-family: var(--mono);
  font-size: 11px;
  border-bottom: 1px solid var(--line);
  padding: 0 0 1px;
}
.full-board:hover {
  border-bottom-color: var(--ink);
}
</style>
