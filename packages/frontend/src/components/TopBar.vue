<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import BrandMark from "./BrandMark.vue";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { useAuth } from "../composables/useAuth";
import { useOptionsModal } from "../composables/useOptionsModal";
import { useBookmarksModal } from "../composables/useBookmarksModal";
import { useCompactViewport } from "../composables/useCompactViewport";
import { useUpdatesSeen } from "../composables/useUpdatesSeen";
import { useLocaleFormat } from "../i18n/format";
import { useCountryNames } from "../i18n/countryNames";
import { flagUrl } from "../data/flags";

const { t } = useI18n();
const { formatNumber } = useLocaleFormat();
const { countryName } = useCountryNames();
const { totalPieces, lockedCount } = usePuzzleSession();
const { user } = useAuth();
const { show: showOptions } = useOptionsModal();
const { showFrom: showBookmarks } = useBookmarksModal();
// The notebook is a desktop affordance: a compact viewport has no room for the
// list, so the control that opens it is not offered there either.
const { compact } = useCompactViewport();
const { unseen: unseenUpdates } = useUpdatesSeen();

const bookmarksEl = ref<HTMLElement | null>(null);

function openBookmarks() {
  showBookmarks(bookmarksEl.value);
}

// The dot marks what is behind the gear, so it has to reach the name a screen
// reader announces too, not only the pixels.
const optionsLabel = computed(() =>
  unseenUpdates.value ? t("topbar.optionsNew") : t("topbar.options"),
);

const progressPct = computed(() =>
  totalPieces.value > 0 ? (lockedCount.value / totalPieces.value) * 100 : 0,
);
</script>

<template>
  <header class="topbar">
    <RouterLink to="/" class="brand">
      <BrandMark />
      <span class="brand-name">Million Piece <em>Puzzle</em></span>
    </RouterLink>

    <div v-if="totalPieces > 0" class="progress-pill" :title="t('topbar.puzzleProgress')">
      <div class="bar">
        <div class="fill" :style="{ width: `${progressPct}%` }"></div>
      </div>
      <span class="num">
        {{ formatNumber(lockedCount) }}<span> / {{ formatNumber(totalPieces) }}</span>
      </span>
    </div>
    <span v-else></span>

    <div class="top-right">
      <template v-if="user && user.pseudo">
        <button
          v-if="!compact"
          ref="bookmarksEl"
          type="button"
          class="bookmarks"
          :title="t('bookmarks.title')"
          :aria-label="t('bookmarks.title')"
          @click="openBookmarks"
        >
          <svg
            viewBox="0 0 16 16"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4.2 2.6h7.6a.6.6 0 0 1 .6.6v10.2L8 10.6l-4.4 2.8V3.2a.6.6 0 0 1 .6-.6z" />
          </svg>
        </button>

        <div class="presence">
          <span v-if="user.country" class="flag" :title="countryName(user.country)">
            <img
              :src="flagUrl(user.country)"
              :alt="countryName(user.country)"
              width="18"
              height="18"
            />
          </span>
          <span class="pseudo" :title="t('topbar.signedInAs', { pseudo: user.pseudo })">
            {{ user.pseudo }}
          </span>
          <button
            type="button"
            class="gear"
            :title="optionsLabel"
            :aria-label="optionsLabel"
            @click="showOptions"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3.2" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
              />
            </svg>
            <span v-if="unseenUpdates" class="new-dot" aria-hidden="true"></span>
          </button>
        </div>
      </template>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  position: fixed;
  inset: 0 0 auto 0;
  height: 52px;
  z-index: 40;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  background: rgba(244, 241, 234, 0.85);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line);
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.brand-name {
  font-family: var(--serif);
  font-weight: 500;
  font-size: 18px;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.brand-name em {
  font-style: italic;
  font-weight: 400;
  color: var(--ink-3);
}
.progress-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px 6px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--paper);
  min-width: 0;
}
.progress-pill .bar {
  width: clamp(48px, 16vw, 140px);
  flex: none;
  height: 5px;
  border-radius: 99px;
  background: var(--ground-2);
  overflow: hidden;
}
.progress-pill .fill {
  height: 100%;
  background: var(--ink);
  border-radius: 99px;
  transition: width 400ms ease-out;
}
.progress-pill .num {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: -0.01em;
  white-space: nowrap;
  flex: none;
}
.progress-pill .num span {
  color: var(--ink-3);
}
.top-right {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
/* Its own box next to the presence pill rather than a control inside it: the
   pill says who you are, this opens a window over the board. Same chrome and
   the same 18px content, so the two read as one row. */
.bookmarks {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--paper);
  color: var(--ink-3);
  cursor: pointer;
  transition:
    background 160ms ease,
    color 160ms ease;
}
.bookmarks:hover {
  background: var(--ground-2);
  color: var(--ink);
}
.presence {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--paper);
  min-width: 0;
}
.presence .flag {
  display: inline-flex;
  border-radius: 50%;
  line-height: 0;
  flex: none;
}
.presence .flag img {
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(21, 20, 15, 0.12);
}
.presence .pseudo {
  font-size: 13px;
  letter-spacing: -0.005em;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  max-width: 22vw;
}
.presence .gear {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
  margin: -4px -6px -4px 0;
  border-radius: var(--radius-pill);
  color: var(--ink-3);
  cursor: pointer;
  transition:
    background 160ms ease,
    color 160ms ease;
}
.presence .gear:hover {
  background: var(--ground-2);
  color: var(--ink);
}
/* The ring is the pill the gear sits on, so the dot keeps its edge over the
   gear's own strokes. */
.presence .new-dot {
  position: absolute;
  top: 2px;
  right: 3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 2px var(--paper);
}
.presence .gear:hover .new-dot {
  box-shadow: 0 0 0 2px var(--ground-2);
}

/* A narrow row is three boxes that all want to grow, so it keeps one thing per
   box and drops the rest rather than truncating all three: the mark stands in
   for the wordmark, the pill keeps the ratio and drops the bar drawing it
   (the ratio reads on its own, and in less width), and the presence pill is the
   pseudo and the gear. */
@media (max-width: 560px) {
  .brand-name {
    display: none;
  }
  .progress-pill {
    padding: 6px 12px;
  }
  .progress-pill .bar {
    display: none;
  }
  .presence .flag {
    display: none;
  }
}

@media (max-width: 420px) {
  .topbar {
    padding: 0 10px;
    gap: 4px;
  }
  .progress-pill {
    padding: 5px 10px;
  }
  .presence {
    padding: 6px 10px;
  }
}
</style>
