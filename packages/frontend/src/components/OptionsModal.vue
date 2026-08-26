<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useOptionsModal } from "../composables/useOptionsModal";
import { useAuthModal } from "../composables/useAuthModal";
import { usePseudoModal } from "../composables/usePseudoModal";
import { useNationalityModal } from "../composables/useNationalityModal";
import { useUpdatesModal } from "../composables/useUpdatesModal";
import { useAuth } from "../composables/useAuth";
import { useDisplaySettings } from "../composables/useDisplaySettings";
import { HUD_PANEL_IDS } from "../data/displaySettings";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useBackdropClick } from "../composables/useBackdropClick";
import GoogleMark from "./GoogleMark.vue";

const { t } = useI18n();
const { open, hide } = useOptionsModal();
const { show: showAuth } = useAuthModal();
const { show: showPseudo } = usePseudoModal();
const { show: showNationality } = useNationalityModal();
const { show: showUpdates } = useUpdatesModal();
const { user, signOut } = useAuth();
const { settings: display, visiblePanels, setReferenceUnderlay, setPanel } = useDisplaySettings();

const DISCORD_URL = "https://discord.gg/mB2juw55R3";

const shellEl = ref<HTMLElement | null>(null);
const trap = useFocusTrap(shellEl, { onEscape: hide });
const { onMousedown, onClick } = useBackdropClick(hide);
watch(open, (isOpen) => (isOpen ? trap.activate() : trap.deactivate()));

// A linked Google account turns the sync action into a read-only synced state:
// the identity it resolves to is what tells the player the account is permanent.
const synced = computed(() => user.value != null && !user.value.guest);
const syncedIdentity = computed(() => user.value?.email ?? user.value?.name ?? null);

// One-liner gameplay hints, stepped through in place rather than opened as
// their own screen: the menu is the only surface a player already comes back to.
const TIP_KEYS = [
  "tips.carry",
  "tips.flags",
  "tips.flagDrop",
  "tips.minimap",
  "tips.reference",
] as const;
const tipIndex = ref(0);
const tip = computed(() => t(TIP_KEYS[tipIndex.value] ?? TIP_KEYS[0]));

function stepTip(delta: number) {
  tipIndex.value = (tipIndex.value + delta + TIP_KEYS.length) % TIP_KEYS.length;
}

// Sync hands off to the (confirmation) auth modal; the profile edits reuse the
// existing pseudo/country modals in their dismissible edit mode.
function sync() {
  hide();
  showAuth();
}
function changePseudo() {
  hide();
  showPseudo("edit");
}
function changeCountry() {
  hide();
  showNationality("edit");
}
function openUpdates() {
  hide();
  showUpdates();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="modal-backdrop options-backdrop"
      @mousedown="onMousedown"
      @click="onClick"
    >
      <div
        ref="shellEl"
        class="modal-shell options-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="options-title"
      >
        <header class="modal-header">
          <h2 id="options-title" class="modal-title">{{ t("options.title") }}</h2>
          <button class="modal-close" :aria-label="t('common.close')" @click="hide">×</button>
        </header>

        <div class="section-head">{{ t("options.account") }}</div>

        <div class="actions">
          <div v-if="synced" class="action synced">
            <svg
              class="check"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span class="synced-text">
              <span class="label">{{ t("options.synced") }}</span>
              <span v-if="syncedIdentity" class="hint">{{ syncedIdentity }}</span>
            </span>
          </div>
          <button v-else-if="user?.guest" type="button" class="action sync" @click="sync">
            <span class="g-mark" aria-hidden="true">
              <GoogleMark />
            </span>
            <span class="sync-text">
              <span class="label">{{ t("options.sync") }}</span>
              <span class="hint">{{ t("options.syncHint") }}</span>
            </span>
          </button>
          <a class="action discord" :href="DISCORD_URL" target="_blank" rel="noopener">
            <svg
              class="discord-mark"
              viewBox="0 0 127.14 96.36"
              width="18"
              height="18"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"
              />
            </svg>
            <span class="label">{{ t("options.discord") }}</span>
          </a>
          <button type="button" class="action" @click="changePseudo">
            <span class="label">{{ t("options.changePseudo") }}</span>
          </button>
          <button type="button" class="action" @click="changeCountry">
            <span class="label">{{ t("options.changeCountry") }}</span>
          </button>
          <button type="button" class="action" @click="openUpdates">
            <span class="label">{{ t("options.updates") }}</span>
          </button>
        </div>

        <section class="section">
          <div class="section-head">{{ t("options.display.title") }}</div>
          <button
            type="button"
            class="action toggle"
            role="switch"
            :aria-checked="display.referenceUnderlay"
            @click="setReferenceUnderlay(!display.referenceUnderlay)"
          >
            <span class="toggle-text">
              <span class="label">{{ t("options.display.underlay") }}</span>
              <span class="hint">{{ t("options.display.underlayHint") }}</span>
            </span>
            <span class="switch" :class="{ on: display.referenceUnderlay }" aria-hidden="true">
              <span class="knob"></span>
            </span>
          </button>

          <div class="panel-grid">
            <button
              v-for="panel in HUD_PANEL_IDS"
              :key="panel"
              type="button"
              class="panel-toggle"
              role="switch"
              :aria-checked="visiblePanels[panel]"
              @click="setPanel(panel, !visiblePanels[panel])"
            >
              <span class="label">{{ t(`options.display.panel.${panel}`) }}</span>
              <span class="switch sm" :class="{ on: visiblePanels[panel] }" aria-hidden="true">
                <span class="knob"></span>
              </span>
            </button>
          </div>
        </section>

        <section class="section tips">
          <div class="section-head tips-head">
            <span>{{ t("tips.title") }}</span>
            <span>{{ tipIndex + 1 }} / {{ TIP_KEYS.length }}</span>
          </div>
          <div class="tips-body">
            <button type="button" class="tip-nav" :aria-label="t('tips.prev')" @click="stepTip(-1)">
              &larr;
            </button>
            <p class="tip" aria-live="polite">{{ tip }}</p>
            <button type="button" class="tip-nav" :aria-label="t('tips.next')" @click="stepTip(1)">
              &rarr;
            </button>
          </div>
        </section>

        <button type="button" class="signout" @click="signOut">{{ t("options.signOut") }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.options-backdrop {
  z-index: 109;
}
.options-modal {
  width: min(380px, calc(100vw - 32px));
  /* Every row plus the tips strip runs past a short phone viewport in all four
     locales, so the shell scrolls rather than off the top and bottom of it.
     dvh over vh because a mobile browser's vh keeps counting the strip its own
     UI covers, which is exactly the band the bottom of this menu lands in. */
  max-height: calc(100vh - 32px);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
}
.modal-header {
  margin-bottom: 14px;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.action {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--paper);
  text-align: left;
  transition: background 160ms ease;
}
.action:hover {
  background: var(--paper-2);
}
.action .label {
  font-size: 14px;
  color: var(--ink);
}
.action .hint {
  font-size: 12px;
  color: var(--ink-3);
  line-height: 1.4;
}
.action.sync,
.action.synced,
.action.discord {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}
.sync-text,
.synced-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
}
.synced-text .hint {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.g-mark,
.check,
.discord-mark {
  flex: none;
}
.g-mark {
  display: inline-grid;
  place-items: center;
}
.check {
  color: #34a853;
}
.discord-mark {
  color: #5865f2;
}
.action.sync {
  border-color: var(--ink);
}
.action.synced {
  cursor: default;
}
.action.synced:hover {
  background: var(--paper);
}
.section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed var(--line);
}
.section-head {
  margin-bottom: 8px;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.tips-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.action.toggle {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.toggle-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
}
/* Hand-drawn rather than a checkbox: the row is a button (so the whole row is
   the target), and a native input inside a button is not focusable on its own. */
.switch {
  flex: none;
  width: 34px;
  height: 20px;
  padding: 2px;
  border-radius: var(--radius-pill);
  background: var(--ground-2);
  border: 1px solid var(--line);
  transition: background 160ms ease;
}
.switch.on {
  background: var(--accent);
  border-color: transparent;
}
.knob {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--paper);
  box-shadow: 0 1px 2px rgba(21, 20, 15, 0.3);
  transition: transform 160ms ease;
}
.switch.on .knob {
  transform: translateX(14px);
}
/* Two compact columns rather than six full-width rows: the panel switches are
   the longest group in the menu, and a phone has to reach the tips and the
   sign-out below them without a scroll it cannot see the end of. Spaced off the
   underlay row by the same gap the account rows use, so the whole section reads
   as one list of display switches rather than two groups. */
.panel-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
}
.panel-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--paper);
  text-align: left;
  transition: background 160ms ease;
}
.panel-toggle:hover {
  background: var(--paper-2);
}
.panel-toggle .label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--ink);
}
.switch.sm {
  width: 28px;
  height: 16px;
}
.switch.sm .knob {
  width: 10px;
  height: 10px;
}
.switch.sm.on .knob {
  transform: translateX(12px);
}
.tips-body {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tip {
  /* Floor over the tallest tip at the modal's own width (3 lines in every
     locale): stepping through them must not resize the modal under the pointer
     doing the stepping. A floor rather than a fixed height so a narrower phone,
     where a tip can wrap to a fourth line, grows the strip instead of clipping
     the text out of its centered box. */
  flex: 1;
  min-width: 0;
  min-height: 58px;
  margin: 0;
  display: grid;
  place-items: center;
  text-align: center;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--ink-2);
}
.tip-nav {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-btn);
  color: var(--ink-4);
  font-size: 14px;
  line-height: 1;
  transition:
    background 160ms ease,
    color 160ms ease;
}
.tip-nav:hover {
  background: var(--ground-2);
  color: var(--ink);
}
.signout {
  width: 100%;
  margin-top: 16px;
  padding: 10px 14px;
  border-radius: var(--radius-btn);
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink-3);
  font-size: 14px;
  transition:
    background 160ms ease,
    color 160ms ease;
}
.signout:hover {
  background: var(--ground-2);
  color: var(--ink);
}

/* A phone reads the whole menu in one screen: the same rows at tighter padding,
   not a different menu. Everything here is spacing, so nothing is cut and no
   row is hidden from the small viewport. */
@media (max-width: 680px) {
  .options-modal {
    width: min(380px, calc(100vw - 20px));
    max-height: calc(100vh - 20px);
    max-height: calc(100dvh - 20px);
    padding: 14px;
  }
  .modal-header {
    margin-bottom: 10px;
  }
  .actions {
    gap: 6px;
  }
  .action {
    padding: 9px 12px;
  }
  .section {
    margin-top: 12px;
    padding-top: 10px;
  }
  .panel-grid {
    gap: 6px;
    margin-top: 6px;
  }
  .panel-toggle {
    padding: 7px 9px;
  }
  .tip {
    min-height: 46px;
  }
  .signout {
    margin-top: 12px;
    padding: 8px 14px;
  }
}
</style>
