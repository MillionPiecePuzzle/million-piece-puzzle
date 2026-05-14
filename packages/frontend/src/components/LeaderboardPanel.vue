<script setup lang="ts">
import { ref } from "vue";
import { leaderboardPanelRows } from "../data/leaderboardMock";
import LeaderboardModal from "./LeaderboardModal.vue";
import LeaderboardRow from "./LeaderboardRow.vue";

const showModal = ref(false);
</script>

<template>
  <aside class="panel leaderboard">
    <div class="lb-head">
      <h3>Leaderboard</h3>
    </div>
    <ol class="lb-list">
      <LeaderboardRow
        v-for="row in leaderboardPanelRows"
        :key="row.rank"
        :row="row"
        rank-width="18px"
      />
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
