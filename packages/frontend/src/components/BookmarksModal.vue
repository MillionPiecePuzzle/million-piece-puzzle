<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ImageManifest, PlayZone } from "@mpp/shared";
import {
  BADGE_PIECES_MAX,
  BADGE_PIECES_MIN,
  BOOKMARK_NAME_MAX,
  BOOKMARK_PAGE_SIZE,
  MAX_BOOKMARKS,
  filterBookmarks,
  normalizeBookmarkName,
  type Bookmark,
  type BookmarkBadge,
  type NewBookmark,
} from "../data/bookmarks";
import { dziTilesPath, manifestBaseUrl, manifestUrlFor } from "../data/manifestUrl";
import { fetchDziInfo, type DziInfo } from "../canvas/dziTiles";
import type { PickedSpot } from "../canvas/puzzleStage";
import { formatBoardPoint, worldToBoard } from "../canvas/boardCoords";
import {
  bookmarkShareUrl,
  parseShareLink,
  sharedBadgeToBadge,
  sharedViewWorldPoint,
} from "../data/shareLink";
import BookmarkBadgeArt from "./BookmarkBadgeArt.vue";
import { useBookmarks } from "../composables/useBookmarks";
import { useBookmarksModal } from "../composables/useBookmarksModal";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { useStageControls } from "../composables/useStageControls";
import { useRelativeTime } from "../composables/useRelativeTime";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useBackdropClick } from "../composables/useBackdropClick";
import { useLocaleFormat } from "../i18n/format";

const { t } = useI18n();
const { open, hide, anchorInset, takeDraft } = useBookmarksModal();
const { state } = usePuzzleSession();
const { controls, camera } = useStageControls();
const { bookmarks, badgePieces, badgeKind, canAdd, setPuzzle, add, remove } = useBookmarks();
const { relativeTime } = useRelativeTime();
const { formatNumber } = useLocaleFormat();

const shellEl = ref<HTMLElement | null>(null);
const trap = useFocusTrap(shellEl, { onEscape: () => backOrClose() });
const { onMousedown, onClick } = useBackdropClick(() => hide());

// Escape leaves the draft or the paste field first and the notebook second: what
// is on screen is what it closes.
function backOrClose(): void {
  if (creating.value) cancelCreate();
  else if (importing.value) cancelImport();
  else hide();
}

// How far the panel's right edge sits inside the viewport, the backdrop's own
// padding. Subtracting it from the control's distance to that same edge turns
// the control's position into an offset inside the panel, which is where the
// open has to grow from.
const PANEL_EDGE_GAP = 16;

const openOrigin = computed(() => {
  const inset = anchorInset.value;
  if (inset === null) return undefined;
  const fromRight = Math.round(Math.max(0, inset - PANEL_EDGE_GAP));
  return { transformOrigin: `calc(100% - ${fromRight}px) top` };
});
// An open is a fresh read of the notebook: an abandoned draft, a filter and a
// page from a previous open never come back with it. A bookmark handed over in a
// link is the one thing that survives an open, and it is consumed by it.
watch(open, (isOpen) => {
  clearCopyFeedback();
  if (isOpen) {
    query.value = "";
    page.value = 0;
    importing.value = false;
    importUrl.value = "";
    void loadDziInfo();
    // The trap first: it takes the panel's first control on the next tick, and a
    // handed draft wants the caret in its name field instead, which it gets by
    // asking for it after.
    trap.activate();
    const handed = takeDraft();
    if (handed) startShared(handed);
    else creating.value = false;
  } else {
    // A closed notebook leaves no aim armed on the board behind it.
    controls.value?.cancelPickSpot();
    trap.deactivate();
  }
});

const manifest = computed<ImageManifest | null>(() =>
  state.value.kind === "ready" || state.value.kind === "syncing" ? state.value.manifest : null,
);
// The bound a pasted link's point is held inside, the same one a pan stops at.
const playZone = computed<PlayZone | null>(() =>
  state.value.kind === "ready" || state.value.kind === "syncing"
    ? state.value.welcome.playZone
    : null,
);
const assetBase = computed(() =>
  manifest.value ? manifestBaseUrl(manifestUrlFor(manifest.value.puzzleId)) : "",
);
const tilesPath = computed(() => (manifest.value ? dziTilesPath(manifest.value.source.dzi) : ""));
// The traced square in world units, which is what the stage draws and what the
// badge stores. Zero until the board is known, which is also when the notebook
// offers nothing to create.
const squareWorld = computed(() => badgePieces.value * (manifest.value?.pieceSize ?? 0));

watch(
  () => manifest.value?.puzzleId ?? null,
  (id) => setPuzzle(id),
  { immediate: true },
);

const query = ref("");
const page = ref(0);
const filtered = computed(() => filterBookmarks(bookmarks.value, query.value));
const pageCount = computed(() =>
  Math.max(1, Math.ceil(filtered.value.length / BOOKMARK_PAGE_SIZE)),
);
const pageRows = computed(() =>
  filtered.value.slice(page.value * BOOKMARK_PAGE_SIZE, (page.value + 1) * BOOKMARK_PAGE_SIZE),
);

// A narrower list is a shorter list: staying on page 4 of a filter that now has
// one page would show an empty list under a pager that says otherwise. The same
// clamp catches the last entry of the last page being deleted.
watch([query, pageCount], () => {
  page.value = Math.min(page.value, pageCount.value - 1);
});
watch(query, () => {
  page.value = 0;
});

// The box the row draws a badge in, in CSS pixels, which is what picks the
// pyramid level it is cut from. Kept with `.badge`'s own size in the stylesheet.
const BADGE_ROW_SIZE = 40;

function positionOf(bookmark: Bookmark): string {
  const m = manifest.value;
  if (!m) return "";
  return formatBoardPoint(worldToBoard(bookmark.worldX, bookmark.worldY, m));
}

// The badge lifted out of its row at a size you can read it at. Bigger than the
// max buys nothing (a pyramid tile is 254px native); under the min there is not
// enough room beside the panel for a preview worth raising, and covering the row
// the pointer is on would be worse than showing nothing.
const BADGE_PEEK_MAX = 192;
const BADGE_PEEK_MIN = 120;
const BADGE_PEEK_GAP = 12;
const PEEK_EDGE_GAP = 16;

const peek = ref<{ badge: BookmarkBadge; size: number; top: number; left: number } | null>(null);

// Beside the panel rather than beside the row: what the preview has to stay
// clear of is the notebook itself, so every row raises it in the same place, and
// a narrow window shrinks it instead of pushing it under the list. Vertically it
// follows its row, held inside the screen so one near the bottom comes back up
// rather than hanging under the fold. A square badge is re-cut at the size it is
// raised to, so the preview is sharp rather than the row's own tiles stretched.
function showPeek(badge: BookmarkBadge, ev: MouseEvent): void {
  const el = ev.currentTarget;
  const shell = shellEl.value;
  if (!(el instanceof HTMLElement) || !shell) return;
  const room = shell.getBoundingClientRect().left - BADGE_PEEK_GAP - PEEK_EDGE_GAP;
  if (room < BADGE_PEEK_MIN) return;
  const size = Math.min(BADGE_PEEK_MAX, room);
  const rect = el.getBoundingClientRect();
  peek.value = {
    badge,
    size,
    left: shell.getBoundingClientRect().left - BADGE_PEEK_GAP - size,
    top: Math.min(
      Math.max(PEEK_EDGE_GAP, rect.top + rect.height / 2 - size / 2),
      window.innerHeight - size - PEEK_EDGE_GAP,
    ),
  };
}

function hidePeek(): void {
  peek.value = null;
}

// The spot, at whatever scale the player is already reading the board at: a
// bookmark records a place and not a framing, so coming back to one never takes
// the zoom out of their hands.
function goTo(bookmark: Bookmark): void {
  hidePeek();
  controls.value?.centerOnWorld(bookmark.worldX, bookmark.worldY);
  hide();
}

// How long the row says the link is in the clipboard: long enough to read, short
// enough that the row is back to itself by the time the player looks again.
const COPIED_FEEDBACK_MS = 2500;

const copiedId = ref<string | null>(null);
const copyFailed = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

function clearCopyFeedback(): void {
  if (copyTimer !== null) clearTimeout(copyTimer);
  copyTimer = null;
  copiedId.value = null;
  copyFailed.value = false;
}

onBeforeUnmount(() => {
  clearCopyFeedback();
  controls.value?.cancelPickSpot();
});

// The spot and the bookmark of it both travel, in the player coordinates the
// readout already shows: what the recipient gets is a draft of this entry, so
// the name and the emblem go with the framing and the entry's own id stays here.
// The scale is the sender's own, since the entry holds none.
async function copyLink(bookmark: Bookmark): Promise<void> {
  const m = manifest.value;
  if (!m) return;
  const url = bookmarkShareUrl(window.location.origin, bookmark, m, camera.value.zoom);
  clearCopyFeedback();
  try {
    await navigator.clipboard.writeText(url);
    copiedId.value = bookmark.id;
  } catch {
    // No clipboard at all (an insecure origin), or a browser refusing the write:
    // an unwritten link is worth nothing, so say so rather than leave the row
    // looking like it worked.
    copyFailed.value = true;
  }
  copyTimer = setTimeout(clearCopyFeedback, COPIED_FEEDBACK_MS);
}

const creating = ref(false);
const aiming = ref(false);
// A draft filled from a link rather than from an aim: nothing is written until
// the recipient saves, and the panel says where it came from so a name someone
// else wrote is read before it is kept.
const shared = ref(false);
const draftName = ref("");
const draftBadge = ref<BookmarkBadge | null>(null);
const draftSpot = ref<{ worldX: number; worldY: number } | null>(null);
const error = ref<string | null>(null);
const nameEl = ref<HTMLInputElement | null>(null);
// A link pasted into the notebook itself, which is the other way one arrives:
// opening it in the address bar reloads the board and drops the hand the player
// is in the middle of, where this reads the same parameters live.
const importing = ref(false);
const importUrl = ref("");
const importEl = ref<HTMLInputElement | null>(null);
const dziInfo = ref<DziInfo | null>(null);
let dziInfoPuzzleId: string | null = null;

// The pyramid's own geometry, needed to lay a square badge out of tiles. Fetched
// on the open, since the list draws badges before anything is created: the
// descriptor is a few hundred bytes and the board's own reveal layer asks for the
// same URL, so this is a cache hit on every open but the first.
async function loadDziInfo(): Promise<void> {
  const m = manifest.value;
  if (!m || dziInfoPuzzleId === m.puzzleId) return;
  try {
    const info = await fetchDziInfo(assetBase.value + m.source.dzi);
    if (manifest.value?.puzzleId !== m.puzzleId) return;
    dziInfo.value = info;
    dziInfoPuzzleId = m.puzzleId;
  } catch (e: unknown) {
    console.warn("[bookmarks] could not read the reference pyramid, no badge can be drawn", e);
  }
}

function startCreate(): void {
  if (!canAdd.value || !controls.value) return;
  creating.value = true;
  shared.value = false;
  draftName.value = "";
  draftBadge.value = null;
  draftSpot.value = null;
  error.value = null;
  void aimAtSpot();
}

function startImport(): void {
  importing.value = true;
  importUrl.value = "";
  error.value = null;
  void nextTick(() => importEl.value?.focus());
}

function cancelImport(): void {
  importing.value = false;
  importUrl.value = "";
  error.value = null;
}

// A pasted link, applied where an opened one would have been: the board is
// framed on the spot it names and the notebook offers the same draft, so the
// player sees what they are about to keep without losing the board they are on.
function applyImport(): void {
  const m = manifest.value;
  const zone = playZone.value;
  if (!m || !zone) return;
  const link = parseShareLink(importUrl.value);
  if (link === null) {
    error.value = t("bookmarks.importBad");
    return;
  }
  const point = sharedViewWorldPoint(link.view, m, zone);
  controls.value?.frameWorld(point.x, point.y, link.view.zoom);
  importing.value = false;
  importUrl.value = "";
  startShared({
    name: link.bookmark.name,
    badge: sharedBadgeToBadge(link.bookmark.badge, point, m),
    worldX: point.x,
    worldY: point.y,
  });
}

// A bookmark that arrived in a link: the same fields an aim fills, filled from
// someone else's entry. The name is selected rather than only focused, since it
// is a stranger's and retyping it should cost one keystroke.
function startShared(entry: NewBookmark): void {
  creating.value = true;
  shared.value = true;
  draftName.value = entry.name;
  draftBadge.value = entry.badge;
  draftSpot.value = { worldX: entry.worldX, worldY: entry.worldY };
  error.value = null;
  void nextTick(() => nameEl.value?.select());
}

// The side the aim traces, which is nothing at all when the badge being taken is
// a piece: the square would then promise something the click does not take.
const aimSquareWorld = computed(() => (badgeKind.value === "area" ? squareWorld.value : 0));

// The spot and its badge are one click on the board: what the player pressed is
// where the bookmark is, and what they chose beforehand is what stands for it.
// The notebook stays on screen with its backdrop let through, so the board it is
// a notebook of is the thing being aimed at.
async function aimAtSpot(): Promise<void> {
  const stage = controls.value;
  if (!stage) return;
  aiming.value = true;
  for (;;) {
    const spot = await stage.pickSpot(aimSquareWorld.value);
    if (!spot) break;
    const badge = badgeFor(spot);
    if (badge !== null) {
      draftBadge.value = badge;
      draftSpot.value = { worldX: spot.worldX, worldY: spot.worldY };
      error.value = null;
      break;
    }
    // Nothing here to stand for the spot: a square of bare ground off the
    // picture, or no loose piece under a click that asked for one. The aim stays
    // armed rather than handing back a draft that would badge an empty box.
    error.value =
      badgeKind.value === "piece" ? t("bookmarks.noPieceHere") : t("bookmarks.nothingHere");
  }
  aiming.value = false;
  if (draftBadge.value !== null) void nextTick(() => nameEl.value?.focus());
}

// What the click takes is what was chosen before it, and only that: a piece is
// the loose piece under the point, refused where there is none rather than
// falling back to the ground it sits on, and a square is the one traced around
// the point. A square with no picture in it at all is refused; one hanging off
// the edge keeps the part that has one.
function badgeFor(spot: PickedSpot): BookmarkBadge | null {
  if (badgeKind.value === "piece") {
    return spot.pieceFile === null ? null : { kind: "piece", file: spot.pieceFile };
  }
  const m = manifest.value;
  const size = squareWorld.value;
  if (!m || size <= 0) return null;
  const x = spot.worldX - size / 2;
  const y = spot.worldY - size / 2;
  const onPicture = x + size > 0 && y + size > 0 && x < m.source.width && y < m.source.height;
  return onPicture ? { kind: "area", x, y, size } : null;
}

// The square is set while the aim is up, so the board redraws it under the cursor
// as the player changes their mind about how much of it the badge holds, and
// drops it whole when they change their mind about taking a square at all.
watch(aimSquareWorld, (side) => {
  if (aiming.value) controls.value?.setPickSquare(side);
});

// A refusal is about the badge that was being taken, so switching badges takes
// it back rather than leaving the panel explaining the other one.
watch(badgeKind, () => {
  if (aiming.value) error.value = null;
});

function cancelCreate(): void {
  creating.value = false;
  error.value = null;
  controls.value?.cancelPickSpot();
}

function save(): void {
  if (!canAdd.value) {
    error.value = t("bookmarks.full", { max: formatNumber(MAX_BOOKMARKS) });
    return;
  }
  const name = normalizeBookmarkName(draftName.value);
  if (name === null) {
    error.value = t("bookmarks.needName");
    return;
  }
  const spot = draftSpot.value;
  if (spot === null || draftBadge.value === null) {
    error.value = t("bookmarks.needBadge");
    return;
  }
  add({ name, worldX: spot.worldX, worldY: spot.worldY, badge: draftBadge.value });
  creating.value = false;
  // The new entry is the first row of the unfiltered list, so the player lands
  // on it rather than on whatever page and filter they were reading before.
  query.value = "";
  page.value = 0;
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="modal-backdrop bookmarks-backdrop"
      :class="{ aiming }"
      @mousedown="onMousedown"
      @click="onClick"
    >
      <div
        ref="shellEl"
        class="modal-shell bookmarks-modal"
        :style="openOrigin"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bookmarks-title"
        @scroll="hidePeek"
      >
        <header class="modal-header">
          <h2 id="bookmarks-title" class="modal-title">
            {{
              creating
                ? shared
                  ? t("bookmarks.sharedTitle")
                  : t("bookmarks.newTitle")
                : importing
                  ? t("bookmarks.importTitle")
                  : t("bookmarks.title")
            }}
          </h2>
          <button class="modal-close" :aria-label="t('common.close')" @click="hide">×</button>
        </header>

        <template v-if="creating">
          <p class="modal-lede">
            {{
              shared
                ? t("bookmarks.sharedLede")
                : !aiming
                  ? t("bookmarks.nameSpot")
                  : badgeKind === "piece"
                    ? t("bookmarks.pickPiece")
                    : t("bookmarks.pickSpot")
            }}
          </p>
          <div v-if="aiming" class="kind" role="group" :aria-label="t('bookmarks.badgeKind')">
            <span class="kind-label">{{ t("bookmarks.badgeKind") }}</span>
            <span class="kind-options">
              <button
                type="button"
                class="kind-option"
                :class="{ on: badgeKind === 'area' }"
                :aria-pressed="badgeKind === 'area'"
                @click="badgeKind = 'area'"
              >
                {{ t("bookmarks.badgeKindArea") }}
              </button>
              <button
                type="button"
                class="kind-option"
                :class="{ on: badgeKind === 'piece' }"
                :aria-pressed="badgeKind === 'piece'"
                @click="badgeKind = 'piece'"
              >
                {{ t("bookmarks.badgeKindPiece") }}
              </button>
            </span>
          </div>
          <div v-if="aiming && badgeKind === 'area'" class="size">
            <label class="size-label" for="bookmark-badge-size">
              {{ t("bookmarks.badgeSize") }}
            </label>
            <input
              id="bookmark-badge-size"
              v-model.number="badgePieces"
              class="size-range"
              type="range"
              :min="BADGE_PIECES_MIN"
              :max="BADGE_PIECES_MAX"
              step="1"
            />
            <span class="size-value">
              {{ t("bookmarks.badgeSizePieces", badgePieces, { named: { n: badgePieces } }) }}
            </span>
          </div>
          <div v-if="!aiming" class="draft">
            <span class="badge" :class="{ empty: !draftBadge }">
              <BookmarkBadgeArt
                v-if="draftBadge"
                :badge="draftBadge"
                :size="BADGE_ROW_SIZE"
                :asset-base="assetBase"
                :tiles-path="tilesPath"
                :dzi="dziInfo"
              />
            </span>
            <input
              ref="nameEl"
              v-model="draftName"
              class="field"
              type="text"
              :maxlength="BOOKMARK_NAME_MAX"
              :placeholder="t('bookmarks.namePlaceholder')"
              :aria-label="t('bookmarks.nameLabel')"
              autocomplete="off"
              @keyup.enter="save"
            />
          </div>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="draft-actions">
            <button type="button" class="ghost" @click="cancelCreate">
              {{ t("common.cancel") }}
            </button>
            <button v-if="!aiming" type="button" class="primary" @click="save">
              {{ t("common.save") }}
            </button>
          </div>
        </template>

        <template v-else-if="importing">
          <p class="modal-lede">{{ t("bookmarks.importLede") }}</p>
          <input
            ref="importEl"
            v-model="importUrl"
            class="field"
            type="text"
            :placeholder="t('bookmarks.importPlaceholder')"
            :aria-label="t('bookmarks.importLabel')"
            autocomplete="off"
            spellcheck="false"
            @keyup.enter="applyImport"
          />
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="draft-actions">
            <button type="button" class="ghost" @click="cancelImport">
              {{ t("common.cancel") }}
            </button>
            <button type="button" class="primary" @click="applyImport">
              {{ t("bookmarks.importAction") }}
            </button>
          </div>
        </template>

        <template v-else>
          <div class="top-actions">
            <button
              type="button"
              class="primary"
              :disabled="!canAdd || !controls"
              @click="startCreate"
            >
              {{ t("bookmarks.add") }}
            </button>
            <button
              type="button"
              class="ghost"
              :disabled="!canAdd || !controls"
              @click="startImport"
            >
              {{ t("bookmarks.import") }}
            </button>
          </div>
          <p v-if="!canAdd" class="full" role="alert">
            {{ t("bookmarks.full", { max: formatNumber(MAX_BOOKMARKS) }) }}
          </p>

          <div class="tools">
            <input
              v-model="query"
              class="field"
              type="search"
              :placeholder="t('bookmarks.filter')"
              :aria-label="t('bookmarks.filter')"
              autocomplete="off"
            />
            <span class="count">
              {{
                t("bookmarks.count", filtered.length, {
                  named: { n: formatNumber(filtered.length) },
                })
              }}
            </span>
          </div>

          <p v-if="bookmarks.length === 0" class="empty">{{ t("bookmarks.empty") }}</p>
          <p v-else-if="filtered.length === 0" class="empty">{{ t("bookmarks.noMatch") }}</p>
          <ul v-else class="rows">
            <li v-for="bookmark in pageRows" :key="bookmark.id" class="row">
              <button
                type="button"
                class="jump"
                :disabled="!controls"
                :aria-label="t('bookmarks.goTo', { name: bookmark.name })"
                @click="goTo(bookmark)"
              >
                <span
                  class="badge"
                  @mouseenter="showPeek(bookmark.badge, $event)"
                  @mouseleave="hidePeek"
                >
                  <BookmarkBadgeArt
                    :badge="bookmark.badge"
                    :size="BADGE_ROW_SIZE"
                    :asset-base="assetBase"
                    :tiles-path="tilesPath"
                    :dzi="dziInfo"
                    lazy
                  />
                </span>
                <span class="text">
                  <span class="name">{{ bookmark.name }}</span>
                  <span class="meta">{{ positionOf(bookmark) }}</span>
                </span>
                <span class="age">{{ relativeTime(bookmark.createdAt) }}</span>
              </button>
              <button
                type="button"
                class="icon"
                :class="{ done: copiedId === bookmark.id }"
                :disabled="!manifest"
                :aria-label="
                  copiedId === bookmark.id
                    ? t('bookmarks.copied')
                    : t('bookmarks.copyLink', { name: bookmark.name })
                "
                @click="copyLink(bookmark)"
              >
                <svg v-if="copiedId === bookmark.id" class="ic" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M3.5 8.4 6.4 11.3 12.5 5"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <svg v-else class="ic" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.1-2.1a2.6 2.6 0 0 0-3.7-3.7l-1 1"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linecap="round"
                  />
                  <path
                    d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.4 8.9a2.6 2.6 0 0 0 3.7 3.7l1-1"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="icon delete"
                :aria-label="t('bookmarks.delete', { name: bookmark.name })"
                @click="remove(bookmark.id)"
              >
                ×
              </button>
            </li>
          </ul>
          <p v-if="copyFailed" class="error" role="alert">{{ t("bookmarks.copyFailed") }}</p>

          <div class="pager">
            <button type="button" :disabled="page === 0" @click="page--">
              &larr; {{ t("bookmarks.prev") }}
            </button>
            <span class="page">{{ page + 1 }} / {{ pageCount }}</span>
            <button type="button" :disabled="page === pageCount - 1" @click="page++">
              {{ t("bookmarks.next") }} &rarr;
            </button>
          </div>
        </template>
      </div>

      <Transition name="peek">
        <div
          v-if="peek"
          class="badge-peek"
          :style="{
            top: `${peek.top}px`,
            left: `${peek.left}px`,
            width: `${peek.size}px`,
            height: `${peek.size}px`,
          }"
          aria-hidden="true"
        >
          <BookmarkBadgeArt
            :badge="peek.badge"
            :size="peek.size"
            :asset-base="assetBase"
            :tiles-path="tilesPath"
            :dzi="dziInfo"
          />
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
/* A window opened from the topbar, not a dialog dropped over the board: it hangs
   under the bar it was opened from, and the board it is a notebook of stays lit
   behind it. The backdrop is still there, invisible, to catch the click that
   closes it. */
.bookmarks-backdrop {
  z-index: 111;
  background: none;
  backdrop-filter: none;
  place-items: start end;
  padding: calc(52px + var(--notice-h, 0px) + 8px) 16px 16px;
}
/* While the player aims, the press belongs to the board: the backdrop stops
   catching it and the panel takes it back, so the notebook stays on screen with
   its own cancel while the click lands on the puzzle. */
.bookmarks-backdrop.aiming {
  pointer-events: none;
}
.bookmarks-backdrop.aiming .bookmarks-modal {
  pointer-events: auto;
}
.bookmarks-modal {
  /* Wide enough for a row to carry its badge, its name and its coordinates on
     one line. */
  width: min(560px, 100%);
  /* Grown from the control that opened it, whose place in the panel's own box
     `openOrigin` computes. */
  animation: bookmarks-open 160ms ease-out;
}
@keyframes bookmarks-open {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
/* The two ways into a new entry, at the top of the panel: what the notebook is
   opened to do is read before the list of what it already holds. */
.top-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.top-actions .primary,
.top-actions .ghost {
  flex: 1;
}
.tools {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.field {
  flex: 1;
  min-width: 0;
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--paper);
  font-size: 14px;
  color: var(--ink);
}
.field:focus {
  outline: none;
  border-color: var(--ink-3);
}
.count {
  flex: none;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
.empty {
  margin: 18px 0;
  text-align: center;
  font-size: 13px;
  color: var(--ink-4);
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.jump {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: var(--radius-row);
  text-align: left;
  transition: background 160ms ease;
}
.jump:hover:not(:disabled) {
  background: var(--ground-2);
}
.jump:disabled {
  cursor: default;
}
/* The badge is a picture of a place, so it carries the same rounded frame in the
   row and in the draft: a photograph, not an icon. Its size here is what
   BADGE_ROW_SIZE names, which is what the level of the pyramid follows. */
.badge {
  flex: none;
  width: 40px;
  height: 40px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--ground-2);
}
.badge.empty {
  border-style: dashed;
}
/* The badge lifted out of its row, out to the left where the panel leaves room.
   Never takes the pointer, so the row underneath keeps the hover that raised
   it. */
.badge-peek {
  position: fixed;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  background: var(--ground-2);
  box-shadow: var(--shadow-panel);
  pointer-events: none;
  z-index: 1;
}
.peek-enter-active,
.peek-leave-active {
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}
/* Slid out of the row, which is to its right, and back into it on the way out. */
.peek-enter-from,
.peek-leave-to {
  opacity: 0;
  transform: translateX(10px);
}
.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: var(--ink);
}
.meta {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
.age {
  flex: none;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
/* The two per-row actions, sharing one shape so neither reads as the main one:
   the row itself is what the player clicks. */
.icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-pill);
  color: var(--ink-4);
  line-height: 1;
  transition:
    background 160ms ease,
    color 160ms ease;
}
.icon:hover:not(:disabled) {
  background: var(--ground-2);
  color: var(--ink);
}
.icon:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
/* The row's own confirmation that the link is in the clipboard, which nothing
   else on screen would say. */
.icon.done {
  color: var(--ink);
}
.ic {
  width: 16px;
  height: 16px;
}
.delete {
  font-size: 18px;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-3);
}
.pager button {
  padding: 4px 8px;
  border-radius: var(--radius-btn);
  color: var(--ink-3);
  font-family: var(--mono);
  font-size: 11px;
}
.pager button:hover:not(:disabled) {
  background: var(--ground-2);
  color: var(--ink);
}
.pager button:disabled {
  color: var(--ink-4);
  opacity: 0.5;
  cursor: default;
}
.primary {
  width: 100%;
  padding: 10px 14px;
  border-radius: var(--radius-btn);
  background: var(--ink);
  color: var(--ground);
  font-size: 14px;
  transition: opacity 160ms ease;
}
.primary:hover:not(:disabled) {
  opacity: 0.9;
}
.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.full {
  margin: 0 0 10px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-3);
}
.draft {
  display: flex;
  align-items: center;
  gap: 10px;
}
/* What the aim takes, chosen before it lands: two options reading as one control,
   so the click has one meaning rather than whichever of the two the board happens
   to offer under it. */
.kind {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.kind-label {
  flex: none;
  font-size: 13px;
  color: var(--ink-3);
}
.kind-options {
  flex: 1;
  display: flex;
  gap: 4px;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
}
.kind-option {
  flex: 1;
  padding: 5px 10px;
  border-radius: calc(var(--radius-btn) - 2px);
  font-size: 13px;
  color: var(--ink-3);
  transition:
    background 160ms ease,
    color 160ms ease;
}
.kind-option:hover:not(.on) {
  background: var(--ground-2);
  color: var(--ink);
}
.kind-option.on {
  background: var(--ink);
  color: var(--ground);
}
/* The square's size, set while the aim is up: one row under the instruction, so
   the slider and the square it resizes are both in view. */
.size {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.size-label {
  flex: none;
  font-size: 13px;
  color: var(--ink-3);
}
.size-range {
  flex: 1;
  min-width: 0;
  accent-color: var(--ink);
}
.size-value {
  flex: none;
  min-width: 66px;
  text-align: right;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
.error {
  margin: 10px 0 0;
  font-family: var(--mono);
  font-size: 12px;
  color: oklch(0.55 0.18 30);
}
.draft-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}
.draft-actions .primary,
.draft-actions .ghost {
  flex: 1;
}
.ghost {
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  color: var(--ink-3);
  font-size: 14px;
  transition:
    background 160ms ease,
    color 160ms ease;
}
.ghost:hover:not(:disabled) {
  background: var(--ground-2);
  color: var(--ink);
}
.ghost:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
