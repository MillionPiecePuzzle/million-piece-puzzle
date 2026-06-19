<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { toCountryRows, toLeaderboardRows } from "../data/leaderboard";
import LeaderboardRow from "./LeaderboardRow.vue";

const { t } = useI18n();
const emit = defineEmits<{ close: [] }>();

const { leaderboard, userId } = usePuzzleSession();

type Mode = "people" | "countries";
const mode = ref<Mode>("people");

const rows = computed(() =>
  mode.value === "people"
    ? toLeaderboardRows(leaderboard.value, userId.value)
    : toCountryRows(leaderboard.value, userId.value),
);

const PAGE_SIZE = 10;
const page = ref(0);
const pageCount = computed(() => Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE)));

const pageRows = computed(() =>
  rows.value.slice(page.value * PAGE_SIZE, page.value * PAGE_SIZE + PAGE_SIZE),
);

watch(mode, () => {
  page.value = 0;
});

function prev(): void {
  if (page.value > 0) page.value--;
}
function next(): void {
  if (page.value < pageCount.value - 1) page.value++;
}
function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") emit("close");
}

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div
      class="panel modal"
      role="dialog"
      aria-modal="true"
      :aria-label="t('leaderboardModal.label')"
    >
      <div class="modal-head">
        <h3>{{ t("common.leaderboard") }}</h3>
        <button type="button" class="close" :aria-label="t('common.close')" @click="emit('close')">
          &times;
        </button>
      </div>
      <div class="seg" role="group" :aria-label="t('leaderboardModal.rankingMode')">
        <button
          type="button"
          :class="{ on: mode === 'people' }"
          :aria-pressed="mode === 'people'"
          @click="mode = 'people'"
        >
          {{ t("leaderboardModal.people") }}
        </button>
        <button
          type="button"
          :class="{ on: mode === 'countries' }"
          :aria-pressed="mode === 'countries'"
          @click="mode = 'countries'"
        >
          {{ t("leaderboardModal.countries") }}
        </button>
      </div>
      <ol class="lb-list">
        <LeaderboardRow
          v-for="row in pageRows"
          :key="row.rank"
          :row="row"
          :show-you-tag="mode === 'people'"
        />
      </ol>
      <div class="modal-foot">
        <button type="button" :disabled="page === 0" @click="prev">
          &larr; {{ t("leaderboardModal.prev") }}
        </button>
        <span class="page">{{ page + 1 }} / {{ pageCount }}</span>
        <button type="button" :disabled="page === pageCount - 1" @click="next">
          {{ t("leaderboardModal.next") }} &rarr;
        </button>
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
.seg {
  display: inline-flex;
  margin-bottom: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  overflow: hidden;
  font-family: var(--mono);
  font-size: 11px;
}
.seg button {
  padding: 5px 14px;
  color: var(--ink-3);
  background: var(--paper);
}
.seg button + button {
  border-left: 1px solid var(--line);
}
.seg button.on {
  background: var(--paper-2);
  color: var(--ink);
}
.seg button:hover:not(.on) {
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
