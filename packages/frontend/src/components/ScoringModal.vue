<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useBackdropClick } from "../composables/useBackdropClick";
import { useLocaleFormat } from "../i18n/format";

const { t } = useI18n();
const { formatNumber } = useLocaleFormat();
const emit = defineEmits<{ close: [] }>();

const { totalPieces } = usePuzzleSession();
const shellEl = ref<HTMLElement | null>(null);
const trap = useFocusTrap(shellEl, { onEscape: () => emit("close") });
const { onMousedown, onClick } = useBackdropClick(() => emit("close"));

const total = computed(() => formatNumber(totalPieces.value));

onMounted(trap.activate);
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop scoring-backdrop" @mousedown="onMousedown" @click="onClick">
      <div
        ref="shellEl"
        class="modal-shell scoring-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scoring-title"
      >
        <header class="modal-header">
          <h2 id="scoring-title" class="modal-title">{{ t("scoring.title") }}</h2>
          <button class="modal-close" :aria-label="t('common.close')" @click="emit('close')">
            &times;
          </button>
        </header>

        <p class="modal-lede">{{ t("scoring.lede") }}</p>

        <ul class="examples">
          <li>
            <span class="badge gain">+1</span>
            <span class="example-text">{{ t("scoring.snapTwo") }}</span>
          </li>
          <li>
            <span class="badge gain">+1</span>
            <span class="example-text">{{ t("scoring.snapCluster") }}</span>
          </li>
        </ul>

        <section class="block">
          <h3>{{ t("scoring.mismatchTitle") }}</h3>
          <p>{{ t("scoring.mismatchBody") }}</p>
        </section>

        <section class="block adds-up">
          <h3>{{ t("scoring.fairTitle") }}</h3>
          <p>{{ t("scoring.fairBody", { total }) }}</p>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scoring-backdrop {
  z-index: 60;
}
.scoring-modal {
  width: min(440px, 100%);
}
.examples {
  list-style: none;
  margin: 0 0 18px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.examples li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--paper-2);
}
.badge {
  flex: none;
  min-width: 34px;
  padding: 2px 0;
  text-align: center;
  border-radius: var(--radius-pill);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--paper);
}
.badge.gain {
  background: var(--c2);
}
.example-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-2);
}
.block {
  margin-bottom: 16px;
}
.block:last-child {
  margin-bottom: 0;
}
.block h3 {
  margin: 0 0 4px;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.block p {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink-2);
}
.adds-up {
  padding: 12px 14px;
  border-radius: var(--radius-btn);
  background: var(--accent-soft);
}
.adds-up h3 {
  color: var(--accent);
}
.adds-up p {
  color: var(--ink);
}
</style>
