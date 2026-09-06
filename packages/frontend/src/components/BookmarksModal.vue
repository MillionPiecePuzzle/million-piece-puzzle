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
  badgeAround,
  bookmarkLabel,
  bookmarksInView,
  dropGoneTags,
  filterBookmarks,
  hasAnyTag,
  knownTagSpelling,
  normalizeBookmarkName,
  normalizeTagName,
  sameTag,
  tagView,
  tagsInView,
  viewTag,
  withTag,
  withoutTag,
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
  canAdd,
  setPuzzle,
  add,
  remove,
  rename,
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
  if (renaming.value !== null) cancelRename();
  else if (tagging.value !== null) closeTagging();
  else if (creating.value) cancelCreate();
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
    view.value = [];
    importing.value = false;
    importUrl.value = "";
    closeTagging();
    cancelRename();
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
  (id) => setPuzzle(id, manifest.value?.pieceSize ?? 0),
  { immediate: true },
);

const query = ref("");
const page = ref(0);
// The words the list is being read through, intersected: a notebook whose words
// overlap is narrowed by as many of them as the player picks, and holding
// nothing is the whole of it. Reset on every open like the filter and the page:
// an open is a fresh read of the notebook.
const view = ref<string[]>([]);
const inView = computed(() => bookmarksInView(bookmarks.value, view.value));
// The selector narrows the notebook and the name filter narrows what is left: a
// tag is a word the player put on a bookmark, a name is what they called it, and
// reading for a name inside a tag or two is what both are for.
const filtered = computed(() => filterBookmarks(inView.value, query.value));

// One walk for every option the selector shows. A word counts inside the current
// reading, since picking it narrows what is already there: a word that would
// empty the list reads as zero before it is picked. The untagged block counts
// against the whole notebook instead, because picking it replaces the reading
// rather than narrowing it: nothing wears a word and no word at the same time.
const tagCounts = computed(() => {
  const worn = new Map<string, number>();
  for (const bookmark of inView.value) {
    for (const name of bookmark.tags) {
      const key = name.toLocaleLowerCase();
      worn.set(key, (worn.get(key) ?? 0) + 1);
    }
  }
  const untagged = bookmarks.value.filter((b) => b.tags.length === 0).length;
  return { worn, untagged };
});

function countIn(name: string): number {
  return tagCounts.value.worn.get(name.toLocaleLowerCase()) ?? 0;
}

// What is left to narrow by, which is every word the notebook holds that the
// list is not already read through.
const pickableViewTags = computed(() =>
  tags.value.filter((name) => !view.value.includes(tagView(name))),
);

// A word is gone as soon as the last bookmark wearing it drops it: a reading
// through a word nobody uses any more would be an empty list under a selector
// offering it. Only that word goes, so what the list was narrowed by besides it
// still holds.
watch([tags, view], () => {
  const kept = dropGoneTags(view.value, tags.value);
  if (kept.length !== view.value.length) view.value = kept;
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

// What a row says the spot is called: the entry's own name, the first word it is
// filed under where it has none, and the panel's stand-in where it has neither.
// The stand-in is a word in the player's language, which is why it is here and
// not in the notebook, whose entries are read back on a browser set to any of
// the four.
function labelOf(bookmark: Bookmark): string {
  return bookmarkLabel(bookmark) || t("bookmarks.unnamed");
}

// What an entry reads under while it is named nothing, which is what a name
// field left empty shows behind the caret.
function fallbackLabel(tags: readonly string[]): string {
  return tags[0] ?? t("bookmarks.unnamed");
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

// The row being renamed, which is where the name is written: a bookmark is
// named in the list it is read in rather than in a form of its own, since what
// the player is correcting is the line in front of them. One at a time, so the
// field is the row.
const renaming = ref<string | null>(null);
const renameDraft = ref("");
const renameEl = ref<HTMLInputElement | null>(null);

function setRenameEl(el: unknown): void {
  if (el instanceof HTMLInputElement) renameEl.value = el;
}

// The stored name and not the label: what the player edits is their own words,
// and clearing the field hands the entry back to its tags, which the placeholder
// behind the caret is already showing.
function startRename(bookmark: Bookmark): void {
  hidePeek();
  renaming.value = bookmark.id;
  renameDraft.value = bookmark.name;
  void nextTick(() => renameEl.value?.select());
}

// Escape leaves the row as it was, and everything else that takes the caret out
// of the field keeps what was typed: a name is a line of text, so there is
// nothing to confirm.
function cancelRename(): void {
  renaming.value = null;
  renameDraft.value = "";
}

function commitRename(): void {
  const id = renaming.value;
  if (id === null) return;
  // Null is a name past the cap, which the field's own maxlength does not let
  // through: the row closes on what it already holds rather than on a refusal
  // nobody can read in a list.
  const name = normalizeBookmarkName(renameDraft.value);
  if (name !== null) rename(id, name);
  cancelRename();
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
// What the tag picker is writing on: a bookmark of the list by its id, or the
// entry being created, which has none yet. It is a view of the panel rather than
// a menu hung off a row: a list of tags is the same shape as the two the panel
// already shows over its own, so it costs no positioning, it scrolls when there
// are many, and the focus trap already holds it.
const TAG_TARGET_DRAFT = "draft";
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

// The selector is a picker rather than the reading itself: it adds a word to
// what the list is narrowed by and falls back to its own label, the row of
// chips under it saying what is being read and taking a word back off.
const VIEW_PICK = "";

function pickView(event: Event): void {
  const el = event.target as HTMLSelectElement;
  const picked = el.value;
  el.value = VIEW_PICK;
  if (picked === VIEW_ALL) view.value = [];
  // The untagged block is the one reading that narrows nothing: a bookmark
  // wearing a word is not in it, so it replaces the words rather than joining
  // them, and a word picked next replaces it back.
  else if (picked === VIEW_UNTAGGED) view.value = [VIEW_UNTAGGED];
  else if (!view.value.includes(picked))
    view.value = [...view.value.filter((entry) => entry !== VIEW_UNTAGGED), picked];
}

function dropView(picked: string): void {
  view.value = view.value.filter((entry) => entry !== picked);
}

// What a picked reading reads as under the selector: the word itself, and the
// panel's own name for the block wearing none, which is a word in the player's
// language rather than the stored `VIEW_UNTAGGED`.
function viewLabel(picked: string): string {
  return viewTag(picked) ?? t("bookmarks.tagUntagged");
}

// The tags a new entry inherits, which are the words the list is being read
// through and nothing at all in the untagged block. Sorted and cut to the cap
// like a stored entry's own, since a reading can run past what one bookmark
// wears.
function viewTags(): string[] {
  return view.value
    .map((entry) => viewTag(entry))
    .filter((tag): tag is string => tag !== null)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_TAGS_PER_BOOKMARK);
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

// The spot and its badge are one click on the board: what the player pressed is
// where the bookmark is, and what they chose beforehand is what stands for it.
// The notebook stays on screen with its backdrop let through, so the board it is
// a notebook of is the thing being aimed at.
async function aimAtSpot(): Promise<void> {
  const stage = controls.value;
  if (!stage) return;
  aiming.value = true;
  for (;;) {
    const spot = await stage.pickSpot(squareWorld.value, resizeBadge);
    if (!spot) break;
    const badge = badgeFor(spot);
    if (badge !== null) {
      draftBadge.value = badge;
      draftSpot.value = { worldX: spot.worldX, worldY: spot.worldY };
      error.value = null;
      break;
    }
    // Nothing here to stand for the spot: a square of bare ground off the
    // picture. The aim stays armed rather than handing back a draft that would
    // badge an empty box.
    error.value = t("bookmarks.nothingHere");
  }
  aiming.value = false;
  if (draftBadge.value !== null) void nextTick(() => nameEl.value?.focus());
}

// What the click takes: the square traced around the point, at the side the aim
// was showing. A square with no picture in it at all is refused; one hanging off
// the edge keeps the part that has one.
function badgeFor(spot: PickedSpot): BookmarkBadge | null {
  const m = manifest.value;
  const size = squareWorld.value;
  if (!m || size <= 0) return null;
  const badge = badgeAround(spot.worldX, spot.worldY, size);
  const onPicture =
    badge.x + size > 0 &&
    badge.y + size > 0 &&
    badge.x < m.source.width &&
    badge.y < m.source.height;
  return onPicture ? badge : null;
}

// The wheel over the board sizes the square while the aim is up, one piece a
// notch, which is what puts the size under the hand that is already aiming
// instead of back on the slider in the panel. The slider stays: it is the same
// setting, and it is what a keyboard and a touchscreen have.
function resizeBadge(step: number): void {
  badgePieces.value = Math.min(
    BADGE_PIECES_MAX,
    Math.max(BADGE_PIECES_MIN, badgePieces.value + step),
  );
}

// The square is set while the aim is up, so the board redraws it under the cursor
// as the player changes their mind about how much of it the badge holds.
watch(squareWorld, (side) => {
  if (aiming.value) controls.value?.setPickSquare(side);
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
  // Empty is a name: an entry kept unnamed reads under the first word it is
  // filed under, and under the panel's stand-in until it wears one. Null is a
  // name past the cap, which the field's own maxlength does not let through.
  const name = normalizeBookmarkName(draftName.value);
  if (name === null) {
    error.value = t("bookmarks.nameTooLong", { max: BOOKMARK_NAME_MAX });
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
  // the filter and the page go, and the reading keeps the words the entry
  // actually wears, so a tag taken back off the draft is not what hides it.
  query.value = "";
  page.value = 0;
  view.value = view.value.filter((entry) => tagsInView(draftTags.value, [entry]));
}

const taggingDraft = computed(() => tagging.value === TAG_TARGET_DRAFT);
const taggedBookmark = computed(() =>
  taggingDraft.value ? null : (bookmarks.value.find((b) => b.id === tagging.value) ?? null),
);
// The words the picker is writing, wherever they are held: the draft's own list
// while the entry is being written, the stored entry's once it is kept.
const taggedTags = computed<readonly string[]>(() =>
  taggingDraft.value ? draftTags.value : (taggedBookmark.value?.tags ?? []),
);

function taggedWears(name: string): boolean {
  return hasAnyTag(taggedTags.value, name);
}

// Everything the picker can offer: the tags the notebook holds, plus the words
// the target already wears. The two are the same list for a bookmark the
// notebook holds, and differ for an entry being written, whose words are on no
// bookmark yet: without them a word created here could never be taken back off,
// since nothing would list it.
const pickableTags = computed(() => {
  const known = tags.value;
  const own = taggedTags.value.filter((name) => !known.some((t) => sameTag(t, name)));
  return own.length === 0 ? known : [...known, ...own].sort((a, b) => a.localeCompare(b));
});

// What the picker lists: everything it can offer, read down to the ones the
// field matches. The ones this bookmark already wears come first, so what it
// carries is read before what it could.
const tagChoices = computed(() => {
  const needle = tagDraft.value.trim().toLocaleLowerCase();
  const matching =
    needle === ""
      ? pickableTags.value
      : pickableTags.value.filter((name) => name.toLocaleLowerCase().includes(needle));
  return [...matching.filter(taggedWears), ...matching.filter((name) => !taggedWears(name))];
});

// A word the notebook does not hold yet, which is what the field offers to
// create: a tag is made by putting it on a bookmark and never before.
const tagDraftIsNew = computed(() => {
  const name = normalizeTagName(tagDraft.value);
  return name !== null && !pickableTags.value.some((t) => sameTag(t, name));
});

const taggedIsFull = computed(() => taggedTags.value.length >= MAX_TAGS_PER_BOOKMARK);

function startTagging(target: string): void {
  hidePeek();
  tagging.value = target;
  tagDraft.value = "";
  error.value = null;
  void nextTick(() => tagDraftEl.value?.focus());
}

function closeTagging(): void {
  tagging.value = null;
  tagDraft.value = "";
  error.value = null;
}

// The two writers the picker works through, one per target: the notebook's own
// for a bookmark it already holds, the draft's list for one still being written,
// where nothing is committed until the entry is saved.
function applyTag(name: string): void {
  const target = tagging.value;
  if (target === null) return;
  if (target === TAG_TARGET_DRAFT) {
    draftTags.value = withTag(draftTags.value, knownTagSpelling(bookmarks.value, name));
  } else tag(target, name);
}

function dropTag(name: string): void {
  const target = tagging.value;
  if (target === null) return;
  if (target === TAG_TARGET_DRAFT) draftTags.value = withoutTag(draftTags.value, name);
  else untag(target, name);
}

// One click is the whole change, on or off, since taking a word back is the same
// click again: a Save button would only stand between the two.
function toggleTag(name: string): void {
  if (tagging.value === null) return;
  if (taggedWears(name)) {
    dropTag(name);
    error.value = null;
    return;
  }
  if (taggedIsFull.value) {
    error.value = t("bookmarks.tagsFull", { max: MAX_TAGS_PER_BOOKMARK });
    return;
  }
  applyTag(name);
  error.value = null;
}

// The field's other job: what it holds becomes a tag on this bookmark, which is
// the only way a tag comes into being.
function createTag(): void {
  if (tagging.value === null) return;
  const name = normalizeTagName(tagDraft.value);
  if (name === null) {
    error.value = t("bookmarks.tagNeedName");
    return;
  }
  if (taggedWears(name)) {
    error.value = t("bookmarks.tagWorn");
    return;
  }
  if (taggedIsFull.value) {
    error.value = t("bookmarks.tagsFull", { max: MAX_TAGS_PER_BOOKMARK });
    return;
  }
  applyTag(name);
  tagDraft.value = "";
  error.value = null;
}

// Enter takes what is in the field: the tag it names when the notebook already
// holds it, and a new one when it does not.
function submitTagDraft(): void {
  const name = normalizeTagName(tagDraft.value);
  if (name === null) return;
  const known = pickableTags.value.find((t) => sameTag(t, name));
  if (known === undefined) createTag();
  else {
    toggleTag(known);
    tagDraft.value = "";
  }
}

const title = computed(() => {
  if (tagging.value !== null) return t("bookmarks.tagsTitle");
  if (creating.value) return shared.value ? t("bookmarks.sharedTitle") : t("bookmarks.newTitle");
  if (importing.value) return t("bookmarks.importTitle");
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

        <template v-if="tagging !== null">
          <p class="modal-lede">
            {{
              taggingDraft || !taggedBookmark
                ? t("bookmarks.tagsDraftLede")
                : t("bookmarks.tagsLede", { name: labelOf(taggedBookmark) })
            }}
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
            {{ pickableTags.length === 0 ? t("bookmarks.tagsNone") : t("bookmarks.tagNoMatch") }}
          </p>
          <ul v-else class="tag-rows">
            <li v-for="name in tagChoices" :key="name" class="tag-row">
              <button
                type="button"
                class="tag-pick"
                :class="{ on: taggedWears(name) }"
                :aria-pressed="taggedWears(name)"
                :disabled="taggedIsFull && !taggedWears(name)"
                @click="toggleTag(name)"
              >
                <span class="tag-mark" aria-hidden="true">
                  <svg v-if="taggedWears(name)" class="ic" viewBox="0 0 16 16" fill="none">
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
              {{ taggingDraft ? t("bookmarks.backToEntry") : t("bookmarks.backToList") }}
            </button>
          </div>
        </template>

        <template v-else-if="creating">
          <p class="modal-lede">
            {{
              shared
                ? t("bookmarks.sharedLede")
                : aiming
                  ? t("bookmarks.pickSpot")
                  : t("bookmarks.nameSpot")
            }}
          </p>
          <div v-if="aiming" class="size">
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
          <p v-if="aiming" class="size-hint">
            {{ t("bookmarks.badgeSizeWheel") }}
          </p>
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
              :placeholder="fallbackLabel(draftTags)"
              :aria-label="t('bookmarks.nameLabel')"
              autocomplete="off"
              @keyup.enter="save"
            />
          </div>
          <div v-if="!aiming" class="draft-tags">
            <span class="tag-label">{{ t("bookmarks.tags") }}</span>
            <span v-for="name in draftTags" :key="name" class="chip">{{ name }}</span>
            <span v-if="draftTags.length === 0" class="none">
              {{ t("bookmarks.tagsNoneYet") }}
            </span>
            <button type="button" class="tag-edit" @click="startTagging(TAG_TARGET_DRAFT)">
              {{ t("bookmarks.tagsPick") }}
            </button>
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
            <select
              v-if="tags.length > 0"
              class="tag-select"
              :value="VIEW_PICK"
              :aria-label="t('bookmarks.tag')"
              @change="pickView"
            >
              <option :value="VIEW_PICK" disabled>{{ t("bookmarks.viewPick") }}</option>
              <option :value="VIEW_ALL">
                {{ t("bookmarks.tagAll") }} ({{ formatNumber(bookmarks.length) }})
              </option>
              <option v-if="!view.includes(VIEW_UNTAGGED)" :value="VIEW_UNTAGGED">
                {{ t("bookmarks.tagUntagged") }} ({{ formatNumber(tagCounts.untagged) }})
              </option>
              <option v-for="name in pickableViewTags" :key="name" :value="tagView(name)">
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

          <div v-if="view.length > 0" class="view-tags">
            <button
              v-for="picked in view"
              :key="picked"
              type="button"
              class="view-chip"
              :aria-label="t('bookmarks.viewDrop', { name: viewLabel(picked) })"
              :title="t('bookmarks.viewDrop', { name: viewLabel(picked) })"
              @click="dropView(picked)"
            >
              <span class="view-name">{{ viewLabel(picked) }}</span>
              <span class="view-drop" aria-hidden="true">×</span>
            </button>
          </div>

          <p v-if="bookmarks.length === 0" class="empty">{{ t("bookmarks.empty") }}</p>
          <p v-else-if="filtered.length === 0" class="empty">
            {{ query.trim() === "" ? t("bookmarks.viewEmpty") : t("bookmarks.noMatch") }}
          </p>
          <ul v-else class="rows">
            <li v-for="bookmark in pageRows" :key="bookmark.id" class="row">
              <div v-if="renaming === bookmark.id" class="jump renaming">
                <span class="badge">
                  <BookmarkBadgeArt
                    :badge="bookmark.badge"
                    :size="BADGE_ROW_SIZE"
                    :asset-base="assetBase"
                    :tiles-path="tilesPath"
                    :dzi="dziInfo"
                  />
                </span>
                <input
                  :ref="setRenameEl"
                  v-model="renameDraft"
                  class="field name-field"
                  type="text"
                  :maxlength="BOOKMARK_NAME_MAX"
                  :placeholder="fallbackLabel(bookmark.tags)"
                  :aria-label="t('bookmarks.nameLabel')"
                  autocomplete="off"
                  @keyup.enter="commitRename"
                  @blur="commitRename"
                />
              </div>
              <button
                v-else
                type="button"
                class="jump"
                :disabled="!controls"
                :aria-label="t('bookmarks.goTo', { name: labelOf(bookmark) })"
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
                  <span class="name" :class="{ unnamed: bookmarkLabel(bookmark) === '' }">
                    {{ labelOf(bookmark) }}
                  </span>
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
                    ? t('bookmarks.unfavorite', { name: labelOf(bookmark) })
                    : t('bookmarks.favorite', { name: labelOf(bookmark) })
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
                :class="{ editing: renaming === bookmark.id }"
                :aria-label="t('bookmarks.rename', { name: labelOf(bookmark) })"
                :title="t('bookmarks.hintRename')"
                @click="startRename(bookmark)"
              >
                <svg class="ic" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M10.9 2.6 13.4 5.1 5.9 12.6 2.6 13.4 3.4 10.1Z"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linejoin="round"
                  />
                  <path d="M9.2 4.3 11.7 6.8" stroke="currentColor" stroke-width="1.4" />
                </svg>
              </button>
              <button
                type="button"
                class="icon"
                :class="{ tagged: bookmark.tags.length > 0 }"
                :aria-label="t('bookmarks.tagsOf', { name: labelOf(bookmark) })"
                :title="t('bookmarks.hintTags')"
                @click="startTagging(bookmark.id)"
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
                    : t('bookmarks.copyLink', { name: labelOf(bookmark) })
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
                :aria-label="t('bookmarks.delete', { name: labelOf(bookmark) })"
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
/* The row while its name is being written: the same line with the name a field
   where it reads, so nothing moves between reading the list and correcting it. */
.jump.renaming,
.jump.renaming:hover {
  background: none;
  cursor: default;
}
.name-field {
  padding: 6px 10px;
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
/* An entry with no name and no word to borrow one from reads under a stand-in,
   which is the panel speaking rather than the player: lighter, so a name written
   by hand is never mistaken for it. */
.name.unnamed {
  color: var(--ink-4);
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
/* The wheel does the same job over the board itself, where the hand already is.
   Said under the slider rather than instead of it: the slider is what a keyboard
   and a touchscreen have. */
.size-hint {
  margin: 4px 0 0;
  font-size: 12px;
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
/* What the list is read through, beside the filter it composes with: the
   selector says which words a bookmark was put under and the filter says what it
   was called. A native control, since nothing bounds the notebook's words at the
   three a row of chips would hold; what is picked out of it is bounded, and that
   is the row under it. */
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
/* The words the list is being read through, under the selector that adds them:
   the control offers what is left to narrow by and each word here comes back off
   in one click, which is the whole of what reading through several needs. */
.view-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.view-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 2px 6px 2px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--ground-2);
  font-size: 12px;
  color: var(--ink-3);
}
.view-chip:hover {
  border-color: var(--ink-3);
  color: var(--ink);
}
.view-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.view-drop {
  flex: none;
  font-size: 15px;
  line-height: 1;
}
/* What the entry being written carries, under its name: the tag it inherited
   from the list being read, plus whatever the player picks here, so filing a
   bookmark is part of writing it rather than a second visit to its row. */
.draft-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.draft-tags .none {
  font-size: 12px;
  color: var(--ink-4);
}
.tag-edit {
  flex: none;
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: none;
  font: inherit;
  font-size: 12px;
  color: var(--ink-3);
  cursor: pointer;
}
.tag-edit:hover {
  border-color: var(--ink-3);
  color: var(--ink);
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
/* Which row the open field belongs to, said on the control that opened it. */
.icon.editing {
  color: var(--ink);
}
</style>
