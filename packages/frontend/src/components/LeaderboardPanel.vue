<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAuth } from "../composables/useAuth";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { toLeaderboardRows, toPersonalRow } from "../data/leaderboard";
import LeaderboardModal from "./LeaderboardModal.vue";
import LeaderboardRow from "./LeaderboardRow.vue";
import ScoringModal from "./ScoringModal.vue";

const { t } = useI18n();
const { leaderboard, myStanding, userId } = usePuzzleSession();
const { user } = useAuth();
const showModal = ref(false);
const showScoring = ref(false);

// Compact panel: the leaders, plus the local user and their neighbour when the
// local user ranks outside the visible leaders. Outside the standings list
// entirely (nothing to slice), their own row comes from the personal standing
// the server sends them instead, so a contributor ranked 4000th still watches
// their own count move.
const panelRows = computed(() => {
  const rows = toLeaderboardRows(leaderboard.value, userId.value);
  const top = rows.slice(0, 6);
  const youIndex = rows.findIndex((r) => r.you);
  if (youIndex >= 6) return [...top, ...rows.slice(youIndex, youIndex + 2)];
  if (youIndex === -1 && myStanding.value && userId.value) {
    return [
      ...top,
      toPersonalRow(myStanding.value, {
        userId: userId.value,
        pseudo: user.value?.pseudo ?? null,
        country: user.value?.country ?? null,
      }),
    ];
  }
  return top;
});
</script>

<template>
  <aside class="panel leaderboard">
    <div class="lb-head">
      <h3>{{ t("common.leaderboard") }}</h3>
      <button
        type="button"
        class="info"
        :aria-label="t('scoring.open')"
        :title="t('scoring.open')"
        @click="showScoring = true"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9.2" stroke="currentColor" stroke-width="1.6" />
          <path d="M12 10.8v5.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <circle cx="12" cy="7.9" r="1.05" fill="currentColor" />
        </svg>
      </button>
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
  <ScoringModal v-if="showScoring" @close="showScoring = false" />
</template>

<style scoped>
.leaderboard {
  width: min(288px, calc(50vw - 24px));
  padding: 14px 14px 10px;
}
.lb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.info {
  flex: none;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  color: var(--ink-4);
  border-radius: var(--radius-btn);
  transition:
    background 160ms ease,
    color 160ms ease;
}
.info:hover {
  background: var(--paper-2);
  color: var(--ink);
}
.info svg {
  width: 14px;
  height: 14px;
  display: block;
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
