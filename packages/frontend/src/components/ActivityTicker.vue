<script setup lang="ts">
type Event = {
  id: number;
  name: string;
  action: string;
  emphasis?: string;
  trailing?: string;
  ts: string;
};

const events: Event[] = [
  { id: 1, name: "jin_k", action: "placed", emphasis: "4 pieces", trailing: "in G-14", ts: "just now" },
  { id: 2, name: "fern.06", action: "completed cluster", emphasis: "“lighthouse west”", ts: "12s" },
  { id: 3, name: "marisol_r", action: "picked up a piece", ts: "38s" },
  { id: 4, name: "you", action: "placed", emphasis: "1 piece", trailing: "· streak 14", ts: "1m" },
];
</script>

<template>
  <aside class="panel ticker">
    <h3>Activity</h3>
    <ul>
      <li v-for="ev in events" :key="ev.id">
        <span class="msg"><b>{{ ev.name }}</b> <em>{{ ev.action }}</em><span v-if="ev.emphasis">&nbsp;{{ ev.emphasis }}</span><em v-if="ev.trailing">&nbsp;{{ ev.trailing }}</em></span>
        <span class="ts">{{ ev.ts }}</span>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.ticker {
  bottom: 16px;
  left: 16px;
  width: 340px;
  padding: 12px 14px;
}
.ticker h3 {
  margin-bottom: 8px;
}
.ticker ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ticker li {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--ink-2);
}
.msg b {
  font-weight: 500;
  color: var(--ink);
}
.msg em {
  font-style: normal;
  color: var(--ink-3);
}
.ts {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-4);
}
</style>
