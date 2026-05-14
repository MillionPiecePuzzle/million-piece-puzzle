<script setup lang="ts">
import { ref } from "vue";

type Row = {
  rank: number;
  name: string;
  initials: string;
  color: string;
  pieces: number;
  online: boolean;
  you?: boolean;
};

const scopes = ["session", "today", "all"] as const;
const scope = ref<(typeof scopes)[number]>("today");

const rows: Row[] = [
  { rank: 1, name: "jin_k", initials: "JK", color: "var(--c2)", pieces: 3184, online: true },
  { rank: 2, name: "fern.06", initials: "FN", color: "var(--c3)", pieces: 2901, online: true },
  { rank: 3, name: "marisol_r", initials: "MR", color: "var(--c1)", pieces: 2477, online: true },
  { rank: 4, name: "tev", initials: "TV", color: "var(--c5)", pieces: 2103, online: true },
  { rank: 5, name: "quietfox", initials: "QU", color: "#7d7468", pieces: 1962, online: false },
  { rank: 6, name: "samo_o", initials: "SO", color: "var(--c4)", pieces: 1748, online: true },
  { rank: 14, name: "you", initials: "YO", color: "var(--accent)", pieces: 912, online: true, you: true },
  { rank: 15, name: "petrichor", initials: "PT", color: "#9a8f7e", pieces: 874, online: false },
];

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
</script>

<template>
  <aside class="panel leaderboard">
    <div class="lb-head">
      <h3>Leaderboard</h3>
      <div class="scope">
        <button
          v-for="s in scopes"
          :key="s"
          :class="{ on: scope === s }"
          @click="scope = s"
        >
          {{ s }}
        </button>
      </div>
    </div>
    <ol class="lb-list">
      <li v-for="row in rows" :key="row.rank" :class="{ you: row.you }">
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
      <span>&uarr; 22 places this hour</span>
      <a href="#">full board</a>
    </div>
  </aside>
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
.scope {
  display: flex;
  gap: 2px;
  background: var(--ground-2);
  padding: 2px;
  border-radius: var(--radius-pill);
}
.scope button {
  padding: 4px 9px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  color: var(--ink-3);
  font-family: var(--mono);
}
.scope button.on {
  background: var(--paper);
  color: var(--ink);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.05);
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
  justify-content: space-between;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-3);
}
.lb-foot a {
  color: var(--ink);
  border-bottom: 1px solid var(--line);
}
</style>
