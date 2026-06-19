<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { LOCALE_NAMES, SUPPORTED_LOCALES, setLocale, type AppLocale } from "../i18n";
import enFlag from "../assets/lang/en.svg";
import frFlag from "flag-icons/flags/1x1/fr.svg";
import esFlag from "flag-icons/flags/1x1/es.svg";
import deFlag from "flag-icons/flags/1x1/de.svg";

const FLAGS: Record<AppLocale, string> = {
  en: enFlag,
  fr: frFlag,
  es: esFlag,
  de: deFlag,
};

const { t, locale } = useI18n();
const current = computed(() => locale.value as AppLocale);

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function choose(value: AppLocale): void {
  setLocale(value);
  open.value = false;
}

function onPointerDown(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") open.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onPointerDown);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="root" class="lang-switcher">
    <button
      type="button"
      class="trigger"
      :aria-label="t('langSwitcher.label')"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="open = !open"
    >
      <img class="flag" :src="FLAGS[current]" :alt="LOCALE_NAMES[current]" width="22" height="22" />
      <svg class="chevron" :class="{ up: open }" viewBox="0 0 12 8" aria-hidden="true">
        <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.5" />
      </svg>
    </button>

    <ul v-if="open" class="menu" role="listbox" :aria-label="t('langSwitcher.label')">
      <li v-for="value in SUPPORTED_LOCALES" :key="value">
        <button
          type="button"
          class="option"
          role="option"
          :aria-selected="value === current"
          :aria-label="LOCALE_NAMES[value]"
          @click="choose(value)"
        >
          <img class="flag" :src="FLAGS[value]" :alt="LOCALE_NAMES[value]" width="22" height="22" />
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.lang-switcher {
  position: relative;
}
.trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition:
    background 150ms ease,
    border-color 150ms ease;
}
.trigger:hover {
  background: rgba(255, 255, 255, 0.9);
}
.flag {
  display: block;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px rgba(21, 20, 15, 0.12);
}
.chevron {
  width: 12px;
  height: 8px;
  color: var(--ink-4);
  transition: transform 150ms ease;
}
.chevron.up {
  transform: rotate(180deg);
}
.menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  margin: 0;
  padding: 6px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--ground);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-panel);
}
.option {
  display: flex;
  align-items: center;
  padding: 5px;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: transparent;
  cursor: pointer;
  transition: background 120ms ease;
}
.option:hover {
  background: rgba(21, 20, 15, 0.06);
}
.option[aria-selected="true"] {
  border-color: var(--line);
  background: rgba(21, 20, 15, 0.05);
}
</style>
