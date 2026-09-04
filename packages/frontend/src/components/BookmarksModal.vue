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
  MAX_TAGS_PER_BOOKMARK,
  TAG_NAME_MAX,
  VIEW_ALL,
  VIEW_UNTAGGED,
  bookmarksInView,
  filterBookmarks,
  hasTag,
  normalizeBookmarkName,
  normalizeTagName,
  sameTag,
  tagView,
  viewTag,
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
import { useFocusTrap } from "../composables/useFocusTrap";
import { useBackdropClick } from "../composables/useBackdropClick";
import { useLocaleFormat } from "../i18n/format";

const { t } = useI18n();
const { open, hide, anchorInset, takeDraft } = useBookmarksModal();
const { state } = usePuzzleSession();
const { controls, camera } = useStageControls();
const {
  bookmarks,
  tags,
  badgePieces,
  badgeKind,
  canAdd,
  setPuzzle,
  add,
  remove,
  toggleFavorite,
  tag,
  untag,
} = useBookmarks();
const { formatNumber } = useLocaleFormat();

const shellEl = ref<HTMLElement | null>(null);
const trap = useFocusTrap(shellEl, { onEscape: () => backOrClose() });
const { onMousedown, onClick } = useBackdropClick(() => hide());

// Escape leaves whatever the panel is showing over its list first and the
// notebook second: what is on screen is what it closes.
function backOrClose(): void {
  if (creating.value) cancelCreate();
  else if (importing.value) cancelImport();
  else if (tagging.value !== null) closeTagging();
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
    view.value = VIEW_ALL;
    importing.value = false;
    importUrl.value = "";
    closeTagging();
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
// Which tag the list is reading, or one of the two views that are not a tag.
// Reset on every open like the filter and the page: an open is a fresh read of
// the notebook.
const view = ref<string>(VIEW_ALL);
// The selector narrows the notebook and the name filter narrows what is left: a
// tag is a word the player put on a bookmark, a name is what they called it, and
// reading for a name inside one tag is what both are for.
const filtered = computed(() =>
  filterBookmarks(bookmarksInView(bookmarks.value, view.value), query.value),
);

// One walk of the notebook for every option the selector shows. A count is what
// makes a tag worth opening, and filtering once per tag to get them would be one
// walk each.
const tagCounts = computed(() => {
  const worn = new Map<string, number>();
  let untagged = 0;
  for (const bookmark of bookmarks.value) {
    if (bookmark.tags.length === 0) untagged += 1;
    for (const name of bookmark.tags) {
      const key = name.toLocaleLowerCase();
      worn.set(key, (worn.get(key) ?? 0) + 1);
    }
  }
  return { worn, untagged };
});

function countIn(name: string): number {
  return tagCounts.value.worn.get(name.toLocaleLowerCase()) ?? 0;
}

// The tag the list is reading, gone as soon as the last bookmark wearing it
// drops it: a view of a word nobody uses any more would be an empty list under a
// selector offering it, so the notebook falls back to everything.
watch([tags, view], () => {
  const reading = viewTag(view.value);
  if (reading !== null && !tags.value.some((t) => sameTag(t, reading))) view.value = VIEW_ALL;
});

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
watch([query, view], () => {
  page.value = 0;
});

// The box the row draws a badge in, in CSS pixels, which is what picks the
// pyramid level it is cut from. Kept with `.badge`'s own size in the stylesheet.
const BADGE_ROW_SIZE = 40;

// How many tags a row shows before counting the rest. A row is one line and a
// tag runs to 24 characters, so five of them cannot be read there at any panel
// width: two are shown, the rest are a number, and the whole list is the row's
// own title.
const ROW_TAGS_SHOWN = 2;

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
// The bookmark whose tags are being written, a view of the panel rather than a
// menu hung off its row: a list of tags is the same shape as the two the panel
// already shows over its own, so it costs no positioning, it scrolls when there
// are many, and the focus trap already holds it.
const tagging = ref<string | null>(null);
// One field for both jobs, which is what keeps a notebook of a hundred tags
// usable: it reads down to the ones that match, and creates what it holds when
// nothing does.
const tagDraft = ref("");
const tagDraftEl = ref<HTMLInputElement | null>(null);
// The tags the entry being written carries, inherited from the list being read:
// marking a second bookmark under the tag you are already working from costs
// nothing.
const draftTags = ref<string[]>([]);
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

// The tag a new entry inherits, which is the one the list is reading and nothing
// at all in the two views that are not a tag.
function viewTags(): string[] {
  const reading = viewTag(view.value);
  return reading === null ? [] : [reading];
}

function startCreate(): void {
  if (!canAdd.value || !controls.value) return;
  creating.value = true;
  shared.value = false;
  draftName.value = "";
  draftBadge.value = null;
  draftSpot.value = null;
  draftTags.value = viewTags();
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
  // No tag travels in a link: what a bookmark is filed under is the recipient's
  // own reading of their notebook, not the sender's, and a URL that wrote words
  // into someone else's would be a strange gift. It lands where they are
  // reading.
  draftTags.value = viewTags();
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
  add({ name, worldX: spot.worldX, worldY: spot.worldY, badge: draftBadge.value }, draftTags.value);
  creating.value = false;
  // The list is left showing the entry just written, wherever its name sorts:
  // the filter and the page go, and the view stays on the tag it inherited.
  query.value = "";
  page.value = 0;
  const inherited = draftTags.value[0];
  view.value = inherited === undefined ? VIEW_ALL : tagView(inherited);
}

const taggedBookmark = computed(() => bookmarks.value.find((b) => b.id === tagging.value) ?? null);

// What the picker lists: every tag the notebook holds, read down to the ones
// the field matches. The ones this bookmark already wears come first, so what
// it carries is read before what it could.
const tagChoices = computed(() => {
  const bookmark = taggedBookmark.value;
  const needle = tagDraft.value.trim().toLocaleLowerCase();
  const matching =
    needle === ""
      ? tags.value
      : tags.value.filter((name) => name.toLocaleLowerCase().includes(needle));
  if (bookmark === null) return matching;
  return [
    ...matching.filter((name) => hasTag(bookmark, name)),
    ...matching.filter((name) => !hasTag(bookmark, name)),
  ];
});

// A word the notebook does not hold yet, which is what the field offers to
// create: a tag is made by putting it on a bookmark and never before.
const tagDraftIsNew = computed(() => {
  const name = normalizeTagName(tagDraft.value);
  return name !== null && !tags.value.some((t) => sameTag(t, name));
});

const taggedIsFull = computed(
  () => (taggedBookmark.value?.tags.length ?? 0) >= MAX_TAGS_PER_BOOKMARK,
);

function startTagging(bookmark: Bookmark): void {
  hidePeek();
  tagging.value = bookmark.id;
  tagDraft.value = "";
  error.value = null;
  void nextTick(() => tagDraftEl.value?.focus());
}

function closeTagging(): void {
  tagging.value = null;
  tagDraft.value = "";
  error.value = null;
}

// One click is the whole change, on or off, since taking a word back is the same
// click again: a Save button would only stand between the two.
function toggleTag(name: string): void {
  const bookmark = taggedBookmark.value;
  if (bookmark === null) return;
  if (hasTag(bookmark, name)) {
    untag(bookmark.id, name);
    error.value = null;
    return;
  }
  if (taggedIsFull.value) {
    error.value = t("bookmarks.tagsFull", { max: MAX_TAGS_PER_BOOKMARK });
    return;
  }
  tag(bookmark.id, name);
  error.value = null;
}

// The field's other job: what it holds becomes a tag on this bookmark, which is
// the only way a tag comes into being.
function createTag(): void {
  const bookmark = taggedBookmark.value;
  if (bookmark === null) return;
  const name = normalizeTagName(tagDraft.value);
  if (name === null) {
    error.value = t("bookmarks.tagNeedName");
    return;
  }
  if (hasTag(bookmark, name)) {
    error.value = t("bookmarks.tagWorn");
    return;
  }
  if (taggedIsFull.value) {
    error.value = t("bookmarks.tagsFull", { max: MAX_TAGS_PER_BOOKMARK });
    return;
  }
  tag(bookmark.id, name);
  tagDraft.value = "";
  error.value = null;
}

// Enter takes what is in the field: the tag it names when the notebook already
// holds it, and a new one when it does not.
function submitTagDraft(): void {
  const name = normalizeTagName(tagDraft.value);
  if (name === null) return;
  const known = tags.value.find((t) => sameTag(t, name));
  if (known === undefined) createTag();
  else {
    toggleTag(known);
    tagDraft.value = "";
  }
}

const title = computed(() => {
  if (creating.value) return shared.value ? t("bookmarks.sharedTitle") : t("bookmarks.newTitle");
  if (importing.value) return t("bookmarks.importTitle");
  if (tagging.value !== null) return t("bookmarks.tagsTitle");
  return t("bookmarks.title");
});
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
          <h2 id="bookmarks-title" class="modal-title">{{ title }}</h2>
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
                :class="{ on: badgeKind === 'piece' }"
                :aria-pressed="badgeKind === 'piece'"
                @click="badgeKind = 'piece'"
              >
                {{ t("bookmarks.badgeKindPiece") }}
              </button>
              <button
                type="button"
                class="kind-option"
                :class="{ on: badgeKind === 'area' }"
                :aria-pressed="badgeKind === 'area'"
                @click="badgeKind = 'area'"
              >
                {{ t("bookmarks.badgeKindArea") }}
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
          <div v-if="!aiming && draftTags.length > 0" class="draft-tags">
            <span class="tag-label">{{ t("bookmarks.tags") }}</span>
            <span v-for="name in draftTags" :key="name" class="chip">{{ name }}</span>
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

        <template v-else-if="tagging !== null">
          <p class="modal-lede">
            {{ t("bookmarks.tagsLede", { name: taggedBookmark?.name ?? "" }) }}
          </p>
          <div class="tag-field">
            <input
              ref="tagDraftEl"
              v-model="tagDraft"
              class="field"
              type="text"
              :maxlength="TAG_NAME_MAX"
              :placeholder="t('bookmarks.tagPlaceholder')"
              :aria-label="t('bookmarks.tagNew')"
              autocomplete="off"
              @keyup.enter="submitTagDraft"
            />
            <button
              type="button"
              class="ghost"
              :disabled="!tagDraftIsNew || taggedIsFull"
              @click="createTag"
            >
              {{ t("bookmarks.tagCreate") }}
            </button>
          </div>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <p v-if="tagChoices.length === 0" class="empty">
            {{ tags.length === 0 ? t("bookmarks.tagsNone") : t("bookmarks.tagNoMatch") }}
          </p>
          <ul v-else class="tag-rows">
            <li v-for="name in tagChoices" :key="name" class="tag-row">
              <button
                type="button"
                class="tag-pick"
                :class="{ on: taggedBookmark !== null && hasTag(taggedBookmark, name) }"
                :aria-pressed="taggedBookmark !== null && hasTag(taggedBookmark, name)"
                :disabled="taggedIsFull && taggedBookmark !== null && !hasTag(taggedBookmark, name)"
                @click="toggleTag(name)"
              >
                <span class="tag-mark" aria-hidden="true">
                  <svg
                    v-if="taggedBookmark !== null && hasTag(taggedBookmark, name)"
                    class="ic"
                    viewBox="0 0 16 16"
                    fill="none"
                  >
                    <path
                      d="M3.5 8.4 6.4 11.3 12.5 5"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
                <span class="tag-name">{{ name }}</span>
                <span class="tag-count">{{ formatNumber(countIn(name)) }}</span>
              </button>
            </li>
          </ul>
          <div class="draft-actions">
            <button type="button" class="ghost" @click="closeTagging">
              {{ t("bookmarks.backToList") }}
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
            <select
              v-if="tags.length > 0"
              v-model="view"
              class="tag-select"
              :aria-label="t('bookmarks.tag')"
            >
              <option :value="VIEW_ALL">
                {{ t("bookmarks.tagAll") }} ({{ formatNumber(bookmarks.length) }})
              </option>
              <option :value="VIEW_UNTAGGED">
                {{ t("bookmarks.tagUntagged") }} ({{ formatNumber(tagCounts.untagged) }})
              </option>
              <option v-for="name in tags" :key="name" :value="tagView(name)">
                {{ name }} ({{ formatNumber(countIn(name)) }})
              </option>
            </select>
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
          <p v-else-if="filtered.length === 0" class="empty">
            {{ query.trim() === "" ? t("bookmarks.viewEmpty") : t("bookmarks.noMatch") }}
          </p>
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
                  <span class="meta">
                    <span class="position">{{ positionOf(bookmark) }}</span>
                    <span
                      v-if="bookmark.tags.length > 0"
                      class="chips"
                      :title="bookmark.tags.join(', ')"
                    >
                      <span
                        v-for="name in bookmark.tags.slice(0, ROW_TAGS_SHOWN)"
                        :key="name"
                        class="chip"
                      >
                        {{ name }}
                      </span>
                      <span v-if="bookmark.tags.length > ROW_TAGS_SHOWN" class="chip more">
                        +{{ bookmark.tags.length - ROW_TAGS_SHOWN }}
                      </span>
                    </span>
                  </span>
                </span>
              </button>
              <button
                type="button"
                class="icon star"
                :class="{ on: bookmark.favorite }"
                :aria-pressed="bookmark.favorite"
                :aria-label="
                  bookmark.favorite
                    ? t('bookmarks.unfavorite', { name: bookmark.name })
                    : t('bookmarks.favorite', { name: bookmark.name })
                "
                :title="
                  bookmark.favorite ? t('bookmarks.hintUnfavorite') : t('bookmarks.hintFavorite')
                "
                @click="toggleFavorite(bookmark.id)"
              >
                <svg
                  class="ic"
                  viewBox="0 0 16 16"
                  :fill="bookmark.favorite ? 'currentColor' : 'none'"
                >
                  <path
                    d="M8 1.8 9.6 6.2 14.3 6.4 10.6 9.2 11.9 13.7 8 11.1 4.1 13.7 5.4 9.2 1.7 6.4 6.4 6.2Z"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="icon"
                :class="{ tagged: bookmark.tags.length > 0 }"
                :aria-label="t('bookmarks.tagsOf', { name: bookmark.name })"
                :title="t('bookmarks.hintTags')"
                @click="startTagging(bookmark)"
              >
                <svg class="ic" viewBox="0 0 16 16" fill="none">
                  <circle cx="5.4" cy="5.4" r="1" fill="currentColor" />
                  <path
                    d="M7.6 2.2H3.2a1 1 0 0 0-1 1v4.4c0 .3.1.5.3.7l5.4 5.4c.4.4 1 .4 1.4 0l4-4c.4-.4.4-1 0-1.4L8.3 2.5a1 1 0 0 0-.7-.3Z"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linejoin="round"
                  />
                </svg>
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
                :title="
                  copiedId === bookmark.id ? t('bookmarks.copied') : t('bookmarks.hintCopyLink')
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
                :title="t('bookmarks.hintDelete')"
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
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
/* The per-row actions, sharing one shape so none reads as the main one: the row
   itself is what the player clicks. */
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
/* A starred row is already at the top of the list, so the star only has to say
   why it is there: filled and in full ink against the outline of the rest. */
.icon.star.on {
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
/* The tag the list is reading, beside the filter it composes with: the selector
   says which word a bookmark was put under and the filter says what it was
   called. A native control, since nothing bounds the list at the three a row of
   chips would hold. */
.tag-select {
  flex: none;
  max-width: 45%;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background: var(--paper);
  font-size: 13px;
  color: var(--ink);
}
.tag-select:focus {
  outline: none;
  border-color: var(--ink-3);
}
/* What the entry being written already carries, under its name: inherited from
   the list being read, so it is shown rather than sprung on the player when the
   row appears. */
.draft-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.tag-label {
  flex: none;
  font-size: 13px;
  color: var(--ink-3);
}
/* The draft has the whole panel's width for one or two words, where a row has
   what its name leaves: nothing is cut here. */
.draft-tags .chip {
  max-width: none;
}
/* The row's own tags, after the coordinates: two of them at most and a count for
   the rest, each held to a width that leaves the line readable however long the
   words are. The whole list is the title, one hover away. */
.chips {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}
.chip {
  flex: 0 1 auto;
  max-width: 84px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--ground-2);
  font-size: 10px;
  color: var(--ink-3);
}
.chip.more {
  flex: none;
  max-width: none;
}
.position {
  flex: none;
}
.tag-rows {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  overflow-y: auto;
}
/* A tag goes on and comes off in one click, so the whole row is the control: the
   tick says whether this bookmark wears it and the count says how many others
   do. */
.tag-pick {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--radius-row);
  text-align: left;
  transition: background 160ms ease;
}
.tag-pick:hover:not(:disabled) {
  background: var(--ground-2);
}
/* At five tags the rest of the list is not a choice any more, so it stops
   offering itself rather than answering with a refusal. */
.tag-pick:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tag-mark {
  flex: none;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  color: var(--ink);
}
.tag-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: var(--ink);
}
.tag-pick.on .tag-name {
  color: var(--ink);
}
.tag-count {
  flex: none;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
/* One field for both jobs: it reads the list down to what it holds, and makes
   that word a tag when the notebook does not have it yet. */
.tag-field {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.tag-field .ghost {
  flex: none;
  padding: 8px 12px;
  font-size: 13px;
}
/* A tagged row says so standing still: which words is a hover away in the list,
   and one click from changing here. */
.icon.tagged {
  color: var(--ink-3);
}
</style>
