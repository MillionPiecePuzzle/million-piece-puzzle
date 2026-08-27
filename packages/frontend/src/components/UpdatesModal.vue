<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useUpdatesModal } from "../composables/useUpdatesModal";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useBackdropClick } from "../composables/useBackdropClick";
import { RELEASES } from "../data/releases";
import { LOCALE_TAGS, type AppLocale } from "../i18n";

const { t, locale } = useI18n();
const { open, hide } = useUpdatesModal();

const shellEl = ref<HTMLElement | null>(null);
const trap = useFocusTrap(shellEl, { onEscape: hide });
const { onMousedown, onClick } = useBackdropClick(hide);
watch(open, (isOpen) => (isOpen ? trap.activate() : trap.deactivate()));

// Formatted in UTC so a midnight timestamp never drifts to the previous or
// next day in the visitor's timezone.
function releaseDate(at: number): string {
  return new Date(at).toLocaleDateString(LOCALE_TAGS[locale.value as AppLocale], {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="modal-backdrop updates-backdrop"
      @mousedown="onMousedown"
      @click="onClick"
    >
      <div
        ref="shellEl"
        class="modal-shell updates-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="updates-title"
      >
        <header class="modal-header">
          <h2 id="updates-title" class="modal-title">{{ t("updates.title") }}</h2>
          <button class="modal-close" :aria-label="t('common.close')" @click="hide">&times;</button>
        </header>

        <section v-for="release in RELEASES" :key="release.version" class="release">
          <div class="release-head">
            <span class="version">v{{ release.version }}</span>
            <span class="date">{{ releaseDate(release.at) }}</span>
          </div>
          <ul class="lines">
            <li v-for="line in release.lines" :key="line">{{ t(line) }}</li>
          </ul>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.updates-backdrop {
  z-index: 110;
}
.updates-modal {
  width: min(440px, 100%);
}
.release {
  margin-bottom: 18px;
}
.release:last-child {
  margin-bottom: 0;
}
.release-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px dashed var(--line);
}
.version {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent);
}
.date {
  font-size: 11px;
  color: var(--ink-4);
}
.lines {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.lines li {
  position: relative;
  padding-left: 14px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-2);
}
.lines li::before {
  content: "";
  position: absolute;
  top: 8px;
  left: 2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--ink-4);
}
</style>
