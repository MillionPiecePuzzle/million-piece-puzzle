<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { leaderboardBoard } from "../data/leaderboardMock";

const emit = defineEmits<{ close: [] }>();

const PAGE_SIZE = 10;
const page = ref(0);
const pageCount = Math.ceil(leaderboardBoard.length / PAGE_SIZE);

const pageRows = computed(() =>
  leaderboardBoard.slice(page.value * PAGE_SIZE, page.value * PAGE_SIZE + PAGE_SIZE),
);

function prev(): void {
  if (page.value > 0) page.value--;
}
function next(): void {
  if (page.value < pageCount - 1) page.value++;
}
function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") emit("close");
}

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="panel modal" role="dialog" aria-modal="true" aria-label="Full leaderboard">
      <div class="modal-head">
        <h3>Leaderboard &middot; full board</h3>
        <button type="button" class="close" aria-label="Close" @click="emit('close')">&times;</button>
      </div>
      <ol class="lb-list">
        <li v-for="row in pageRows" :key="row.rank" :class="{ you: row.you }">
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
      <div class="modal-foot">
        <button type="button" :disabled="page === 0" @click="prev">&larr; prev</button>
        <span class="page">{{ page + 1 }} / {{ pageCount }}</span>
        <button type="button" :disabled="page === pageCount - 1" @click="next">next &rarr;</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgba(21, 20, 15, 0.32);
  backdrop-filter: blur(2px);
}
.modal {
  position: relative;
  width: 420px;
  max-width: calc(100vw - 32px);
  padding: 16px 18px 12px;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.close {
  font-size: 20px;
  line-height: 1;
  color: var(--ink-4);
  padding: 0 4px;
}
.close:hover {
  color: var(--ink);
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
  grid-template-columns: 22px 22px 1fr auto;
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
.modal-foot {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-3);
}
.modal-foot button {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink);
  padding: 4px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--paper);
}
.modal-foot button:hover:not(:disabled) {
  background: var(--paper-2);
}
.modal-foot button:disabled {
  color: var(--ink-4);
  cursor: default;
}
</style>
