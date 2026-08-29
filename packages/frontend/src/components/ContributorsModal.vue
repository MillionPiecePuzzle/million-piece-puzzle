<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { toCountryRows, toContributorsRows } from "../data/contributors";
import { useCountryNames } from "../i18n/countryNames";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useBackdropClick } from "../composables/useBackdropClick";
import ContributorsRow from "./ContributorsRow.vue";

const { t } = useI18n();
const emit = defineEmits<{ close: [] }>();

const { leaderboard, userId } = usePuzzleSession();
const { countryName } = useCountryNames();
const shellEl = ref<HTMLElement | null>(null);
const trap = useFocusTrap(shellEl, { onEscape: () => emit("close") });
const { onMousedown, onClick } = useBackdropClick(() => emit("close"));

type Mode = "people" | "countries";
const mode = ref<Mode>("people");

const rows = computed(() =>
  mode.value === "people"
    ? toContributorsRows(leaderboard.value, userId.value)
    : toCountryRows(leaderboard.value, userId.value, countryName),
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

onMounted(trap.activate);
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @mousedown="onMousedown" @click="onClick">
      <div
        ref="shellEl"
        class="panel modal"
        role="dialog"
        aria-modal="true"
        :aria-label="t('contributors.all')"
      >
        <div class="modal-head">
          <h3>{{ t("contributors.title") }}</h3>
          <button
            type="button"
            class="close"
            :aria-label="t('common.close')"
            @click="emit('close')"
          >
            &times;
          </button>
        </div>
        <div class="seg" role="group" :aria-label="t('contributors.viewMode')">
          <button
            type="button"
            :class="{ on: mode === 'people' }"
            :aria-pressed="mode === 'people'"
            @click="mode = 'people'"
          >
            {{ t("contributors.people") }}
          </button>
          <button
            type="button"
            :class="{ on: mode === 'countries' }"
            :aria-pressed="mode === 'countries'"
            @click="mode = 'countries'"
          >
            {{ t("contributors.countries") }}
          </button>
        </div>
        <ol class="contributors-list">
          <ContributorsRow
            v-for="row in pageRows"
            :key="row.rank"
            :row="row"
            :show-you-tag="mode === 'people'"
          />
        </ol>
        <div class="modal-foot">
          <button type="button" :disabled="page === 0" @click="prev">
            &larr; {{ t("contributors.prev") }}
          </button>
          <span class="page">{{ page + 1 }} / {{ pageCount }}</span>
          <button type="button" :disabled="page === pageCount - 1" @click="next">
            {{ t("contributors.next") }} &rarr;
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(21, 20, 15, 0.32);
  backdrop-filter: blur(2px);
}
/* A page of ten rows plus the mode switch and the pager outgrows a short
   viewport, so the shell takes the padded backdrop as its bound and the rows
   scroll under a head and a pager that stay put. */
.modal {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 420px;
  max-width: 100%;
  max-height: 100%;
  /* Not a scroller itself (the rows are), but a box that clips is what makes
     the max-height above resolve against the backdrop rather than against its
     own content. */
  overflow: hidden;
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
  /* The shell is a flex column, which blockifies its children and stretches
     them across the cross axis, so the switch needs to opt out of the stretch
     to stay as wide as its two buttons. */
  align-self: flex-start;
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
.contributors-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
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
