<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { usePuzzleSession, type ActivityEntry } from "../composables/usePuzzleSession";

const { activity } = usePuzzleSession();

// A place reports the placed group (one piece or an N-piece cluster). A snap
// reports the resulting cluster (always >= 2): two single pieces read "two pieces
// together", anything larger reads as the cluster it formed.
function objectPhrase(entry: ActivityEntry): string {
  if (entry.kind === "snap") {
    return entry.count === 2 ? "two pieces together" : `a ${entry.count}-piece cluster`;
  }
  return entry.count === 1 ? "a piece" : `a ${entry.count}-piece cluster`;
}

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 10000);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

function relativeTime(at: number): string {
  const seconds = Math.max(0, Math.round((now.value - at) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
</script>

<template>
  <aside class="panel ticker">
    <h3>Activity</h3>
    <ul v-if="activity.length > 0">
      <li v-for="entry in activity" :key="entry.id">
        <span class="msg"
          ><b>{{ entry.actor }}</b> <em>{{ entry.kind === "place" ? "placed" : "connected" }}</em>
          {{ objectPhrase(entry) }}</span
        >
        <span class="ts">{{ relativeTime(entry.at) }}</span>
      </li>
    </ul>
    <p v-else class="empty">No activity yet.</p>
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
  white-space: nowrap;
}
.empty {
  margin: 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
</style>
