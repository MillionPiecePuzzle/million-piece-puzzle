<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ImageManifest } from "@mpp/shared";
import {
  BOOKMARK_NAME_MAX,
  BOOKMARK_PAGE_SIZE,
  MAX_BOOKMARKS,
  filterBookmarks,
  normalizeBookmarkName,
  type Bookmark,
} from "../data/bookmarks";
import { dziTilesPath, manifestBaseUrl, manifestUrlFor } from "../data/manifestUrl";
import { badgeTileLevel, dziTilesForRect, fetchDziInfo, type DziInfo } from "../canvas/dziTiles";
import { formatBoardPoint, worldToBoard } from "../canvas/boardCoords";
import { useBookmarks } from "../composables/useBookmarks";
import { useBookmarksModal } from "../composables/useBookmarksModal";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { useStageControls } from "../composables/useStageControls";
import { useRelativeTime } from "../composables/useRelativeTime";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useBackdropClick } from "../composables/useBackdropClick";
import { useLocaleFormat } from "../i18n/format";
import ReferenceViewer from "./ReferenceViewer.vue";

const { t } = useI18n();
const { open, hide } = useBookmarksModal();
const { state } = usePuzzleSession();
const { controls, camera } = useStageControls();
const { bookmarks, canAdd, setPuzzle, add, remove } = useBookmarks();
const { relativeTime } = useRelativeTime();
const { formatNumber } = useLocaleFormat();

const shellEl = ref<HTMLElement | null>(null);
const trap = useFocusTrap(shellEl, { onEscape: () => (creating.value ? cancelCreate() : hide()) });
const { onMousedown, onClick } = useBackdropClick(() => hide());
// An open is a fresh read of the notebook: an abandoned draft, a filter and a
// page from a previous open never come back with it.
watch(open, (isOpen) => {
  if (isOpen) {
    creating.value = false;
    query.value = "";
    page.value = 0;
    trap.activate();
  } else {
    trap.deactivate();
  }
});

const manifest = computed<ImageManifest | null>(() =>
  state.value.kind === "ready" || state.value.kind === "syncing" ? state.value.manifest : null,
);
const assetBase = computed(() =>
  manifest.value ? manifestBaseUrl(manifestUrlFor(manifest.value.puzzleId)) : "",
);

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

function badgeUrl(bookmark: Bookmark): string {
  return assetBase.value + bookmark.badge;
}

function positionOf(bookmark: Bookmark): string {
  const m = manifest.value;
  if (!m) return "";
  return formatBoardPoint(worldToBoard(bookmark.worldX, bookmark.worldY, m));
}

function goTo(bookmark: Bookmark): void {
  controls.value?.frameWorld(bookmark.worldX, bookmark.worldY, bookmark.zoom);
  hide();
}

// How many of the pieces on screen the picker offers. Enough rows to choose
// from at a glance, few enough that opening the picker over a dense pile is a
// handful of texture requests the board has already made and not a page of them.
const BADGE_PIECE_CHOICES = 24;

// Where the badge is cut from. The photo answers everywhere, which is what makes
// it the fallback; the pieces answer only where the player has swept some, which
// is what makes them the better answer to "what is this spot" outside the frame.
type BadgeSource = "pieces" | "photo";

const creating = ref(false);
const source = ref<BadgeSource>("photo");
const pieceChoices = ref<string[]>([]);
const pickerAspect = computed(() =>
  manifest.value ? `${manifest.value.source.width / manifest.value.source.height}` : "1",
);
const draftName = ref("");
const draftBadge = ref<string | null>(null);
const error = ref<string | null>(null);
const nameEl = ref<HTMLInputElement | null>(null);
const dziInfo = ref<DziInfo | null>(null);
let dziInfoPuzzleId: string | null = null;

// The pyramid's own geometry, needed to name the tile a click lands in. Fetched
// when the photo source is shown rather than with the modal: the descriptor is a
// few hundred bytes and the viewer below asks for the same URL, so this is a
// cache hit on every open but the first.
async function loadDziInfo(): Promise<void> {
  const m = manifest.value;
  if (!m || dziInfoPuzzleId === m.puzzleId) return;
  try {
    const info = await fetchDziInfo(assetBase.value + m.source.dzi);
    if (manifest.value?.puzzleId !== m.puzzleId) return;
    dziInfo.value = info;
    dziInfoPuzzleId = m.puzzleId;
  } catch (e: unknown) {
    console.warn("[bookmarks] could not read the reference pyramid, no badge can be picked", e);
  }
}

// The pieces are read once, when the picker opens, not followed live: the board
// moves under the player and a list reshuffling itself while they aim at a piece
// would take the piece away from under the pointer.
function startCreate(): void {
  if (!canAdd.value || !controls.value) return;
  creating.value = true;
  draftName.value = "";
  draftBadge.value = null;
  error.value = null;
  pieceChoices.value = controls.value.residentPieceFiles(BADGE_PIECE_CHOICES);
  selectSource(pieceChoices.value.length > 0 ? "pieces" : "photo");
  void nextTick(() => nameEl.value?.focus());
}

// The pyramid descriptor is only worth its request once the photo is on screen:
// a player badging the spot with a piece never opens it.
function selectSource(next: BadgeSource): void {
  source.value = next;
  if (next === "photo") void loadDziInfo();
}

function cancelCreate(): void {
  creating.value = false;
  error.value = null;
}

// The badge is the tile of the reference photo the player clicked, at the one
// level a badge is ever cut from: a place on the picture, chosen for what it
// shows rather than derived from where the bookmark is, so a tile of sky can
// stand for a pile of sky sorted far outside the frame.
function onPickBadge(image: { x: number; y: number }): void {
  const info = dziInfo.value;
  const m = manifest.value;
  if (!info || !m) return;
  const level = badgeTileLevel(info, m.pieceSize);
  const [tile] = dziTilesForRect(
    info,
    level,
    { minX: image.x, minY: image.y, maxX: image.x, maxY: image.y },
    dziTilesPath(m.source.dzi),
  );
  if (!tile) return;
  draftBadge.value = tile.url;
  error.value = null;
}

// A piece out of the area the bookmark names, kept as its own asset path: the
// same shape under the same base as a photo tile, so one stored string covers
// both sources.
function onPickPiece(file: string): void {
  draftBadge.value = file;
  error.value = null;
}

function save(): void {
  const name = normalizeBookmarkName(draftName.value);
  if (name === null) {
    error.value = t("bookmarks.needName");
    return;
  }
  if (draftBadge.value === null) {
    error.value = t("bookmarks.needBadge");
    return;
  }
  add({
    name,
    worldX: camera.value.centerX,
    worldY: camera.value.centerY,
    zoom: camera.value.zoom,
    badge: draftBadge.value,
  });
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
      @mousedown="onMousedown"
      @click="onClick"
    >
      <div
        ref="shellEl"
        class="modal-shell bookmarks-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bookmarks-title"
      >
        <header class="modal-header">
          <h2 id="bookmarks-title" class="modal-title">
            {{ creating ? t("bookmarks.newTitle") : t("bookmarks.title") }}
          </h2>
          <button class="modal-close" :aria-label="t('common.close')" @click="hide">×</button>
        </header>

        <template v-if="creating">
          <div
            v-if="pieceChoices.length > 0"
            class="seg"
            role="group"
            :aria-label="t('bookmarks.badgeSource')"
          >
            <button
              type="button"
              :class="{ on: source === 'pieces' }"
              :aria-pressed="source === 'pieces'"
              @click="selectSource('pieces')"
            >
              {{ t("bookmarks.sourcePieces") }}
            </button>
            <button
              type="button"
              :class="{ on: source === 'photo' }"
              :aria-pressed="source === 'photo'"
              @click="selectSource('photo')"
            >
              {{ t("bookmarks.sourcePhoto") }}
            </button>
          </div>
          <p class="modal-lede">
            {{ source === "pieces" ? t("bookmarks.pickPiece") : t("bookmarks.pickBadge") }}
          </p>
          <ul v-if="source === 'pieces'" class="pieces">
            <li v-for="file in pieceChoices" :key="file">
              <button
                type="button"
                class="piece"
                :class="{ on: draftBadge === file }"
                :aria-pressed="draftBadge === file"
                :aria-label="t('bookmarks.usePiece')"
                @click="onPickPiece(file)"
              >
                <img :src="assetBase + file" alt="" crossorigin="anonymous" decoding="async" />
              </button>
            </li>
          </ul>
          <div v-else class="picker" :style="{ '--ar': pickerAspect }">
            <ReferenceViewer
              v-if="manifest"
              class="picker-viewer"
              :manifest="manifest"
              aiming
              @pick="onPickBadge"
            />
          </div>
          <div class="draft">
            <span class="badge" :class="{ empty: !draftBadge }">
              <img
                v-if="draftBadge"
                :src="assetBase + draftBadge"
                alt=""
                crossorigin="anonymous"
                decoding="async"
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
            <button type="button" class="primary" @click="save">{{ t("common.save") }}</button>
          </div>
        </template>

        <template v-else>
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
                <span class="badge">
                  <img
                    :src="badgeUrl(bookmark)"
                    alt=""
                    crossorigin="anonymous"
                    loading="lazy"
                    decoding="async"
                  />
                </span>
                <span class="text">
                  <span class="name">{{ bookmark.name }}</span>
                  <span class="meta">
                    {{ positionOf(bookmark) }} &middot; {{ Math.round(bookmark.zoom * 100) }}%
                  </span>
                </span>
                <span class="age">{{ relativeTime(bookmark.createdAt) }}</span>
              </button>
              <button
                type="button"
                class="delete"
                :aria-label="t('bookmarks.delete', { name: bookmark.name })"
                @click="remove(bookmark.id)"
              >
                ×
              </button>
            </li>
          </ul>

          <div v-if="pageCount > 1" class="pager">
            <button type="button" :disabled="page === 0" @click="page--">
              &larr; {{ t("bookmarks.prev") }}
            </button>
            <span class="page">{{ page + 1 }} / {{ pageCount }}</span>
            <button type="button" :disabled="page === pageCount - 1" @click="page++">
              {{ t("bookmarks.next") }} &rarr;
            </button>
          </div>

          <button
            type="button"
            class="primary add"
            :disabled="!canAdd || !controls"
            @click="startCreate"
          >
            {{ t("bookmarks.add") }}
          </button>
          <p v-if="!canAdd" class="full" role="alert">
            {{ t("bookmarks.full", { max: formatNumber(MAX_BOOKMARKS) }) }}
          </p>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.bookmarks-backdrop {
  /* Over the settings menu that opens it, which stays behind rather than
     unmounting, so closing this returns to the board directly. */
  z-index: 111;
}
.bookmarks-modal {
  /* Wide enough for a row to carry its badge, its name and its coordinates on
     one line, and for the picker below to show the photo at a size you can aim
     at. */
  width: min(560px, 100%);
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
/* The badge is a photo tile, so it carries the same rounded frame in the row
   and in the draft: a picture of a place, not an icon. */
.badge {
  flex: none;
  width: 40px;
  height: 40px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--ground-2);
}
.badge img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.badge.empty {
  border-style: dashed;
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
.delete {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-pill);
  color: var(--ink-4);
  font-size: 18px;
  line-height: 1;
  transition:
    background 160ms ease,
    color 160ms ease;
}
.delete:hover {
  background: var(--ground-2);
  color: var(--ink);
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
.add {
  margin-top: 14px;
}
.full {
  margin: 8px 0 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-3);
}
/* The picker holds the photo's own aspect ratio, capped so the name field and
   the buttons under it stay on screen without scrolling the shell. */
.picker {
  aspect-ratio: var(--ar);
  max-height: 46vh;
  margin-bottom: 12px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  background: var(--ground-2);
}
.picker-viewer {
  width: 100%;
  height: 100%;
}
/* The two badge sources, on the switch the contributors modal already uses.
   Absent, not disabled, where the board offers no piece: there is nothing to
   switch to and the photo alone answers. */
.seg {
  display: inline-flex;
  margin-bottom: 10px;
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
/* The pieces on screen, in the room the photo picker takes, so switching source
   does not resize the window under the player. Each tile keeps its own square:
   a piece texture carries its tab margin in the alpha, so the silhouette needs
   the whole cell to read as a piece rather than as a crop. */
.pieces {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
  gap: 6px;
  max-height: 46vh;
  overflow-y: auto;
}
.piece {
  width: 100%;
  aspect-ratio: 1;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--ground-2);
  transition:
    border-color 160ms ease,
    background 160ms ease;
}
.piece:hover {
  background: var(--paper-2);
}
.piece.on {
  border-color: var(--ink);
  background: var(--paper-2);
}
.piece img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.draft {
  display: flex;
  align-items: center;
  gap: 10px;
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
.ghost:hover {
  background: var(--ground-2);
  color: var(--ink);
}
</style>
