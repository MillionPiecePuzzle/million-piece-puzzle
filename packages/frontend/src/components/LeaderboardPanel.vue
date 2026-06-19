<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { toLeaderboardRows } from "../data/leaderboard";
import LeaderboardModal from "./LeaderboardModal.vue";
import LeaderboardRow from "./LeaderboardRow.vue";

const { t } = useI18n();
const { leaderboard, userId } = usePuzzleSession();
const showModal = ref(false);

// Compact panel: the leaders, plus the local user and their neighbour when the
// local user ranks outside the visible leaders.
const panelRows = computed(() => {
  const rows = toLeaderboardRows(leaderboard.value, userId.value);
  const top = rows.slice(0, 6);
  const youIndex = rows.findIndex((r) => r.you);
  const tail = youIndex >= 6 ? rows.slice(youIndex, youIndex + 2) : [];
  return [...top, ...tail];
});
</script>

<template>
  <aside class="panel leaderboard">
    <div class="lb-head">
      <h3>{{ t("common.leaderboard") }}</h3>
    </div>
    <template v-if="panelRows.length > 0">
      <ol class="lb-list">
        <LeaderboardRow v-for="row in panelRows" :key="row.rank" :row="row" rank-width="18px" />
      </ol>
      <div class="lb-foot">
        <button type="button" class="full-board" @click="showModal = true">
          {{ t("common.fullBoard") }}
        </button>
      </div>
    </template>
    <p v-else class="empty">{{ t("common.noStandings") }}</p>
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
.empty {
  margin: 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
</style>
