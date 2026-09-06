<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ImageManifest, PlayZone } from "@mpp/shared";
import {
  BADGE_PIECES,
  BOOKMARK_NAME_MAX,
  BOOKMARK_PAGE_SIZE,
  MAX_BOOKMARKS,
  MAX_TAGS_PER_BOOKMARK,
  VIEW_ALL,
  VIEW_UNTAGGED,
  badgeAround,
  bookmarkLabel,
  bookmarksInView,
  dropGoneTags,
  filterBookmarks,
  knownTagSpelling,
  normalizeBookmarkName,
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
  NOTEBOOK_FILE_MAX_BYTES,
  formatBookmarkCode,
  notebookFile,
  notebookFileName,
  parseBookmarkCode,
  parseNotebookFile,
  sharedBadgeToBadge,
} from "../data/bookmarkTransfer";
import { sharedViewWorldPoint } from "../data/viewLink";
import BookmarkBadgeArt from "./BookmarkBadgeArt.vue";
import BookmarkTagsField from "./BookmarkTagsField.vue";
import { useBookmarks } from "../composables/useBookmarks";
import { useBookmarksModal } from "../composables/useBookmarksModal";
import { usePuzzleSession } from "../composables/usePuzzleSession";
import { useStageControls } from "../composables/useStageControls";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useLocaleFormat } from "../i18n/format";

const { t } = useI18n();
const { open, hide, anchorInset, pressedAnchor } = useBookmarksModal();
const { state } = usePuzzleSession();
const { controls, camera } = useStageControls();
const {
  bookmarks,
  tags,
  canAdd,
  setPuzzle,
  add,
  merge,
  remove,
  rename,
  toggleFavorite,
  tag,
  untag,
} = useBookmarks();
const { formatNumber } = useLocaleFormat();

const shellEl = ref<HTMLElement | null>(null);
const trap = useFocusTrap(shellEl, { onEscape: () => backOrClose() });

// Escape leaves whatever the panel is showing over its list first and the
// notebook second: what is on screen is what it closes.
function backOrClose(): void {
  if (tagsFor.value !== null) closeRowTags();
  else if (renaming.value !== null) cancelRename();
  // The aim first, since it is what the press is over: the form it belongs to
  // stays, with whatever is already written in it.
  else if (aiming.value) controls.value?.cancelPickSpot();
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
// page from a previous open never come back with it.
watch(open, (isOpen) => {
  clearCopyFeedback();
  clearFileFeedback();
  if (isOpen) {
    query.value = "";
    page.value = 0;
    view.value = [];
    creating.value = false;
    importing.value = false;
    importCode.value = "";
    closeRowTags();
    cancelRename();
    void loadDziInfo();
    trap.activate();
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
const squareWorld = computed(() => BADGE_PIECES * (manifest.value?.pieceSize ?? 0));

watch(
  () => manifest.value?.puzzleId ?? null,
  (id) => setPuzzle(id),
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

// Where the entry being written stands, in the coordinates every other reading
// of a place uses: it is what the form has to show of the spot besides its
// badge, and what the player reads back to check they took the right one.
const draftPosition = computed(() => {
  const m = manifest.value;
  const spot = draftSpot.value;
  if (!m || !spot) return "";
  return formatBoardPoint(worldToBoard(spot.worldX, spot.worldY, m));
});

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
function showPeek(badge: BookmarkBadge | null, ev: MouseEvent): void {
  const el = ev.currentTarget;
  const shell = shellEl.value;
  // Nothing to lift out of a row wearing the default badge: the mark is the same
  // mark at any size.
  if (badge === null || !(el instanceof HTMLElement) || !shell) return;
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

// How long the row says the bookmark is in the clipboard: long enough to read,
// short enough that the row is back to itself by the time the player looks again.
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
  window.removeEventListener("pointerdown", onPressOutsideTags, true);
  window.removeEventListener("pointerdown", onPressOutside, true);
});

// The row itself, in one line someone can paste into a message: the place in the
// player coordinates the readout already shows, the emblem, the name and the
// words it is filed under. What the recipient gets is a draft of this entry, so
// the id and the star stay here. The scale is the sender's own, since the entry
// holds none.
async function copyCode(bookmark: Bookmark): Promise<void> {
  const m = manifest.value;
  if (!m) return;
  const code = formatBookmarkCode(bookmark, m, camera.value.zoom);
  clearCopyFeedback();
  try {
    await navigator.clipboard.writeText(code);
    copiedId.value = bookmark.id;
  } catch {
    // No clipboard at all (an insecure origin), or a browser refusing the write:
    // an unwritten line is worth nothing, so say so rather than leave the row
    // looking like it worked.
    copyFailed.value = true;
  }
  copyTimer = setTimeout(clearCopyFeedback, COPIED_FEEDBACK_MS);
}

const creating = ref(false);
const aiming = ref(false);
// A draft filled from a bookmark someone sent rather than from an aim: nothing
// is written until the recipient saves, and the panel says where it came from so
// a name someone else wrote is read before it is kept.
const shared = ref(false);
const draftName = ref("");
const draftBadge = ref<BookmarkBadge | null>(null);
const draftSpot = ref<{ worldX: number; worldY: number } | null>(null);
const error = ref<string | null>(null);
const nameEl = ref<HTMLInputElement | null>(null);
// A bookmark someone sent, pasted into the notebook: it is read against the
// board already on screen, so keeping a spot someone handed over never costs the
// player the hand they are in the middle of.
const importing = ref(false);
const importCode = ref("");
const importEl = ref<HTMLInputElement | null>(null);
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
// through and nothing at all in the untagged block, in the order they were
// picked and cut to the cap like a stored entry's own, since a reading can run
// past what one bookmark wears.
function viewTags(): string[] {
  return view.value
    .map((entry) => viewTag(entry))
    .filter((tag): tag is string => tag !== null)
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
}

function startImport(): void {
  importing.value = true;
  importCode.value = "";
  error.value = null;
  void nextTick(() => importEl.value?.focus());
}

function cancelImport(): void {
  importing.value = false;
  importCode.value = "";
  error.value = null;
}

// A pasted bookmark: the board is framed on the spot it names and the notebook
// offers it as a draft, so the player sees what they are about to keep without
// losing the board they are on.
function applyImport(): void {
  const m = manifest.value;
  const zone = playZone.value;
  if (!m || !zone) return;
  const sent = parseBookmarkCode(importCode.value);
  if (sent === null) {
    error.value = t("bookmarks.importBad");
    return;
  }
  const point = sharedViewWorldPoint(sent.view, m, zone);
  controls.value?.frameWorld(point.x, point.y, sent.view.zoom);
  importing.value = false;
  importCode.value = "";
  startShared(
    {
      name: sent.name,
      badge: sharedBadgeToBadge(sent.badge, point, m),
      worldX: point.x,
      worldY: point.y,
    },
    sent.tags,
  );
}

// A bookmark someone sent: the same fields an aim fills, filled from their own
// entry. The name is selected rather than only focused, since it is a stranger's
// and retyping it should cost one keystroke.
function startShared(entry: NewBookmark, tags: readonly string[]): void {
  creating.value = true;
  shared.value = true;
  draftName.value = entry.name;
  draftBadge.value = entry.badge;
  draftSpot.value = { worldX: entry.worldX, worldY: entry.worldY };
  // The words the sender filed it under, under the spelling this notebook
  // already gives them, so a word it already holds is joined rather than stood
  // next to. An entry sent wearing none lands where the player is reading, like
  // one of their own.
  draftTags.value =
    tags.length > 0 ? tags.map((name) => knownTagSpelling(bookmarks.value, name)) : viewTags();
  error.value = null;
  void nextTick(() => nameEl.value?.select());
}

// The notebook itself, written to a file and read back from one: a list kept per
// browser has no other way of following its player to another one. What a row
// hands to someone else is one spot; what this carries is the notebook whole,
// every entry with its star, its words and its age.
const fileEl = ref<HTMLInputElement | null>(null);
const fileNotice = ref<string | null>(null);
const fileError = ref<string | null>(null);

function clearFileFeedback(): void {
  fileNotice.value = null;
  fileError.value = null;
}

function exportNotebook(): void {
  const m = manifest.value;
  if (!m) return;
  clearFileFeedback();
  const blob = new Blob([notebookFile(m.puzzleId, bookmarks.value, new Date())], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = notebookFileName(m.puzzleId, new Date());
  link.click();
  // Freed on the next turn rather than straight after the click, which some
  // browsers read as the download being cancelled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// The picked file, read against the board on screen. The input is cleared before
// anything else, so picking the same file twice is two imports and not one: a
// player who edited it in between is asking for it to be read again.
async function importNotebook(event: Event): Promise<void> {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0];
  input.value = "";
  const m = manifest.value;
  if (!file || !m) return;
  clearFileFeedback();
  if (file.size > NOTEBOOK_FILE_MAX_BYTES) {
    fileError.value = t("bookmarks.fileTooBig");
    return;
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    fileError.value = t("bookmarks.fileBad");
    return;
  }
  const read = parseNotebookFile(text, m.puzzleId);
  if (read.kind === "other-board") {
    fileError.value = t("bookmarks.fileOtherBoard");
    return;
  }
  if (read.kind === "bad") {
    fileError.value = t("bookmarks.fileBad");
    return;
  }
  const added = merge(read.bookmarks);
  // The list is left showing what was just written: a reading and a page from
  // before the import would hide most of it.
  query.value = "";
  page.value = 0;
  view.value = [];
  fileNotice.value =
    added === 0
      ? t("bookmarks.fileNothingNew")
      : t("bookmarks.fileAdded", added, { named: { n: formatNumber(added) } });
}

// The spot and its badge are one click on the board: what the player pressed is
// where the bookmark is, and the square around it is what stands for it. The
// notebook stays on screen with its backdrop let through, so the board it is a
// notebook of is the thing being aimed at. Every point answers, since a spot on
// bare ground is a spot worth keeping: it comes back with no badge rather than
// with a refusal.
// The aim is a step of the form the player asks for and leaves: it is armed from
// the control beside the badge, one click on the board takes the spot, and the
// board is its own again straight after, with the form still open. The place can
// be taken again the same way, so nothing about the entry is held hostage to it.
async function aimAtSpot(): Promise<void> {
  const stage = controls.value;
  if (!stage) return;
  aiming.value = true;
  const spot = await stage.pickSpot(squareWorld.value);
  if (spot) {
    draftBadge.value = badgeFor(spot);
    draftSpot.value = { worldX: spot.worldX, worldY: spot.worldY };
    error.value = null;
    void nextTick(() => nameEl.value?.focus());
  }
  aiming.value = false;
}

// The same control arms the aim and gives it up, since while it is up the board
// is what the player is looking at and the panel is out of their way.
function toggleAim(): void {
  if (aiming.value) controls.value?.cancelPickSpot();
  else void aimAtSpot();
}

// What the click takes: the square traced around the point, the one side every
// aim traces, and nothing at all where there is no picture to cut it from. One
// hanging off the edge keeps the part that has one.
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
  // The place is the whole of what an entry must have: its badge is a picture of
  // that place where there is one, and the panel's own mark where there is not.
  const spot = draftSpot.value;
  if (spot === null) {
    error.value = t("bookmarks.needSpot");
    return;
  }
  add({ name, worldX: spot.worldX, worldY: spot.worldY, badge: draftBadge.value }, draftTags.value);
  creating.value = false;
  // The aim outlives the click that answered it now, so the save is what takes
  // it back off the board.
  controls.value?.cancelPickSpot();
  // The list is left showing the entry just written, wherever its name sorts:
  // the filter and the page go, and the reading keeps the words the entry
  // actually wears, so a tag taken back off the draft is not what hides it.
  query.value = "";
  page.value = 0;
  view.value = view.value.filter((entry) => tagsInView(draftTags.value, [entry]));
}

// The draft's own words, which are committed by the save and by nothing else:
// the spelling the notebook already knows wins, so a word typed back with other
// capitals joins the tag it already is.
function tagDraftEntry(name: string): void {
  draftTags.value = withTag(draftTags.value, knownTagSpelling(bookmarks.value, name));
}

function untagDraftEntry(name: string): void {
  draftTags.value = withoutTag(draftTags.value, name);
}

// The row whose words are open, in a popup hung under its own control rather
// than in a view of the panel: filing an entry is a line of the list changing,
// not a screen to walk into and back out of. A child of the panel, so the focus
// trap already holds it and it travels with the list it hangs off, and placed in
// the panel's own layout coordinates rather than against the window, which the
// transform the panel opens with would put somewhere else entirely.
const TAGS_POPUP_WIDTH = 260;
const TAGS_POPUP_GAP = 6;

const tagsFor = ref<string | null>(null);
const tagsAt = ref<{ top: number; left: number }>({ top: 0, left: 0 });
const tagsPopupEl = ref<HTMLElement | null>(null);
const tagsAnchorEl = ref<HTMLElement | null>(null);

const tagsForBookmark = computed(() => bookmarks.value.find((b) => b.id === tagsFor.value) ?? null);

function toggleRowTags(bookmark: Bookmark, ev: MouseEvent): void {
  const el = ev.currentTarget;
  if (!(el instanceof HTMLElement)) return;
  if (tagsFor.value === bookmark.id) {
    closeRowTags();
    return;
  }
  hidePeek();
  tagsAt.value = {
    top: el.offsetTop + el.offsetHeight + TAGS_POPUP_GAP,
    left: Math.max(0, el.offsetLeft + el.offsetWidth - TAGS_POPUP_WIDTH),
  };
  tagsAnchorEl.value = el;
  tagsFor.value = bookmark.id;
  void settleRowTags(el);
}

// The row it hangs off can be the last one of a page, where the popup would open
// past the panel's own fold: it goes above its control instead, once it has been
// drawn and its height is a fact rather than a guess.
async function settleRowTags(anchor: HTMLElement): Promise<void> {
  await nextTick();
  const shell = shellEl.value;
  const popup = tagsPopupEl.value;
  if (!shell || !popup) return;
  const above = anchor.offsetTop - popup.offsetHeight - TAGS_POPUP_GAP;
  const fold = shell.scrollTop + shell.clientHeight - TAGS_POPUP_GAP;
  if (tagsAt.value.top + popup.offsetHeight > fold && above >= shell.scrollTop) {
    tagsAt.value = { ...tagsAt.value, top: above };
  }
}

function closeRowTags(): void {
  tagsFor.value = null;
  tagsAnchorEl.value = null;
}

// A press anywhere else puts the popup away, its own control excepted, which
// closes it by toggling. The press itself is left alone rather than swallowed:
// it is a popup over a list and not a layer in front of it, so a row pressed
// while it is open does what pressing that row does.
function onPressOutsideTags(ev: PointerEvent): void {
  const target = ev.target;
  if (!(target instanceof Node)) return;
  if (tagsPopupEl.value?.contains(target) || tagsAnchorEl.value?.contains(target)) return;
  closeRowTags();
}

watch(tagsFor, (id) => {
  if (id === null) window.removeEventListener("pointerdown", onPressOutsideTags, true);
  else window.addEventListener("pointerdown", onPressOutsideTags, true);
});

// The row it hangs off can go while it is open: the last word of a reading is
// taken back off, or the entry itself is deleted.
watch(tagsForBookmark, (bookmark) => {
  if (tagsFor.value !== null && bookmark === null) closeRowTags();
});

// A press anywhere else puts the notebook away, which its backdrop cannot do for
// it: that backdrop catches nothing so the board stays live underneath, so the
// close is read off the press itself. The control it hangs off is excepted, since
// it closes the panel by toggling. The form that places an entry is excepted
// whole: it is filled by clicks on the board behind it, and a draft is not
// something a press meant for the puzzle should cost.
function onPressOutside(ev: PointerEvent): void {
  const target = ev.target;
  if (!(target instanceof Node)) return;
  if (shellEl.value?.contains(target) || pressedAnchor(target)) return;
  // A name being typed in the list keeps what was typed, as it does whenever the
  // caret leaves the field: the panel goes before the blur could commit it.
  commitRename();
  hide();
}

watch([open, creating, importing], ([isOpen, isCreating, isImporting]) => {
  if (isOpen && !isCreating && !isImporting)
    window.addEventListener("pointerdown", onPressOutside, true);
  else window.removeEventListener("pointerdown", onPressOutside, true);
});

const title = computed(() => {
  if (creating.value) return shared.value ? t("bookmarks.sharedTitle") : t("bookmarks.newTitle");
  if (importing.value) return t("bookmarks.importTitle");
  return t("bookmarks.title");
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop bookmarks-backdrop">
      <div
        ref="shellEl"
        class="modal-shell bookmarks-modal"
        :style="openOrigin"
        role="dialog"
        aria-modal="false"
        aria-labelledby="bookmarks-title"
        @scroll="hidePeek"
      >
        <header class="modal-header">
          <h2 id="bookmarks-title" class="modal-title">{{ title }}</h2>
          <button class="modal-close" :aria-label="t('common.close')" @click="hide">×</button>
        </header>

        <template v-if="creating">
          <p v-if="shared" class="modal-lede">{{ t("bookmarks.sharedLede") }}</p>
          <div v-if="!shared" class="aim">
            <button
              type="button"
              class="aim-button"
              :class="{ on: aiming }"
              :disabled="!controls"
              :aria-pressed="aiming"
              @click="toggleAim"
            >
              {{
                aiming
                  ? t("bookmarks.aimClick")
                  : draftSpot
                    ? t("bookmarks.aimMove")
                    : t("bookmarks.aimPlace")
              }}
            </button>
            <span class="aim-position">{{ draftPosition }}</span>
          </div>
          <div class="draft">
            <span class="badge" :class="{ unplaced: !draftSpot }">
              <BookmarkBadgeArt
                v-if="draftSpot"
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
          <BookmarkTagsField
            class="draft-tags"
            :tags="draftTags"
            :known="tags"
            @add="tagDraftEntry"
            @remove="untagDraftEntry"
          />
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="draft-actions">
            <button type="button" class="ghost" @click="cancelCreate">
              {{ t("common.cancel") }}
            </button>
            <button type="button" class="primary" :disabled="!draftSpot" @click="save">
              {{ t("common.save") }}
            </button>
          </div>
        </template>

        <template v-else-if="importing">
          <p class="modal-lede">{{ t("bookmarks.importLede") }}</p>
          <input
            ref="importEl"
            v-model="importCode"
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
                :class="{ tagged: bookmark.tags.length > 0, editing: tagsFor === bookmark.id }"
                :aria-label="t('bookmarks.tagsOf', { name: labelOf(bookmark) })"
                :aria-expanded="tagsFor === bookmark.id"
                :title="t('bookmarks.hintTags')"
                @click="toggleRowTags(bookmark, $event)"
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
                    : t('bookmarks.copy', { name: labelOf(bookmark) })
                "
                :title="copiedId === bookmark.id ? t('bookmarks.copied') : t('bookmarks.hintCopy')"
                @click="copyCode(bookmark)"
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
                  <rect
                    x="5.6"
                    y="5.6"
                    width="8"
                    height="8"
                    rx="1.6"
                    stroke="currentColor"
                    stroke-width="1.4"
                  />
                  <path
                    d="M10.4 5.6V4a1.6 1.6 0 0 0-1.6-1.6H4A1.6 1.6 0 0 0 2.4 4v4.8A1.6 1.6 0 0 0 4 10.4h1.6"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
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

          <div class="file-actions">
            <button
              type="button"
              :disabled="!manifest || bookmarks.length === 0"
              @click="exportNotebook"
            >
              {{ t("bookmarks.fileExport") }}
            </button>
            <button type="button" :disabled="!manifest || !canAdd" @click="fileEl?.click()">
              {{ t("bookmarks.fileImport") }}
            </button>
            <input
              ref="fileEl"
              class="file-input"
              type="file"
              accept="application/json,.json"
              @change="importNotebook"
            />
          </div>
          <p v-if="fileError" class="error" role="alert">{{ fileError }}</p>
          <p v-else-if="fileNotice" class="notice" role="status">{{ fileNotice }}</p>
        </template>

        <div
          v-if="tagsForBookmark"
          ref="tagsPopupEl"
          class="tags-popup"
          role="group"
          :aria-label="t('bookmarks.tagsOf', { name: labelOf(tagsForBookmark) })"
          :style="{ top: `${tagsAt.top}px`, left: `${tagsAt.left}px` }"
        >
          <BookmarkTagsField
            :tags="tagsForBookmark.tags"
            :known="tags"
            autofocus
            @add="tag(tagsForBookmark.id, $event)"
            @remove="untag(tagsForBookmark.id, $event)"
          />
        </div>
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
   behind it. The press always belongs to the board: the backdrop catches nothing
   and the panel takes it back, so the board pans, zooms and plays under an open
   notebook. It is the one panel of the game that works this way, because it is
   the one whose whole subject is out there: a spot is aimed at, read against the
   picture, and reached, all with the list of the others still in front of you.
   The press that lands outside still puts the list away, read off the press
   rather than caught by the backdrop; the form that places an entry is what it
   leaves alone, that form being filled by clicks on the board behind it. */
.bookmarks-backdrop {
  z-index: 111;
  background: none;
  backdrop-filter: none;
  place-items: start end;
  padding: calc(52px + var(--notice-h, 0px) + 8px) 16px 16px;
  pointer-events: none;
}
.bookmarks-backdrop .bookmarks-modal {
  pointer-events: auto;
}
.bookmarks-modal {
  /* Wide enough for a row to carry its badge, its name and its coordinates on
     one line. */
  width: min(560px, 100%);
  /* The box the tag popup is placed in, which is also the box it scrolls with. */
  position: relative;
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
/* The box a badge will be, while the entry has no place yet. Its own modifier
   rather than `empty`, which is the panel's word for a list with nothing in it
   and carries that message's margins. */
.badge.unplaced {
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
/* The row's own confirmation that the bookmark is in the clipboard, which
   nothing else on screen would say. */
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
/* The notebook as a whole, under the list it is a notebook of: a file is what
   carries it to another browser, where a row carries one spot to another
   player. */
.file-actions {
  display: flex;
  justify-content: center;
  gap: 14px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}
.file-actions button {
  padding: 2px 4px;
  font-size: 11px;
  color: var(--ink-3);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.file-actions button:hover:not(:disabled) {
  color: var(--ink);
}
.file-actions button:disabled {
  color: var(--ink-4);
  opacity: 0.5;
  cursor: default;
}
.file-input {
  display: none;
}
.notice {
  margin: 10px 0 0;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink-3);
  text-align: center;
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
  margin-top: 12px;
}
/* Where the spot is and the control that takes it, on one quiet line: the entry
   is the name and the badge, and this is the place they are about to be about.
   The aim is asked for and given up from that one control, so the board is only
   ever taken over while the player is holding it, and it lights up while it is,
   since what is waiting for them is out on the board and not in this panel. */
.aim {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.aim-position {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
.aim-button {
  flex: none;
  padding: 3px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  font-size: 12px;
  color: var(--ink-3);
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease;
}
.aim-button:hover:not(:disabled) {
  border-color: var(--ink-3);
  color: var(--ink);
}
.aim-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.aim-button.on,
.aim-button.on:hover {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--ground);
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
   from the list being read, plus whatever is written here, so filing a bookmark
   is part of writing it rather than a second visit to its row. */
.draft-tags {
  margin-top: 12px;
}
/* The same field a draft is filed through, hung under the row's own control and
   inside the panel's own box, so it travels with the list rather than hanging
   over it. Its width is what `TAGS_POPUP_WIDTH` places it by. */
.tags-popup {
  position: absolute;
  z-index: 1;
  width: 260px;
  max-height: 260px;
  overflow-y: auto;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  background: var(--paper);
  box-shadow: var(--shadow-panel);
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
