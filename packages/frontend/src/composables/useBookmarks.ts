import { computed, ref } from "vue";
import {
  BADGE_PIECES_DEFAULT,
  MAX_BOOKMARKS,
  addBookmark,
  addTag,
  allTags,
  readBookmarks,
  removeBookmark,
  removeTag,
  renameBookmark,
  toggleBookmarkFavorite,
  writeBookmarks,
  type Bookmark,
  type NewBookmark,
} from "../data/bookmarks";

// The player's bookmark notebook, shared by the menu row and the list. Per
// browser and keyed by puzzle id like the personal flags, so a board switch
// never resurrects coordinates from another puzzle.
const bookmarks = ref<Bookmark[]>([]);
const puzzleId = ref<string | null>(null);
// How wide the next badge square is traced, in pieces. Held for the page rather
// than stored: it is a choice about the spot being marked, not a preference about
// the board, and the one thing worth carrying is not having to set it again for
// the second bookmark of the same pile.
const badgePieces = ref(BADGE_PIECES_DEFAULT);

function commit(next: Bookmark[]): void {
  bookmarks.value = next;
  if (puzzleId.value) writeBookmarks(puzzleId.value, next);
}

export function useBookmarks() {
  // The piece size rides along because the notebook is read against it: an entry
  // whose badge cannot be read is drawn with the default square, which is a
  // number of pieces.
  function setPuzzle(next: string | null, pieceSize: number): void {
    if (puzzleId.value === next) return;
    puzzleId.value = next;
    bookmarks.value = next ? readBookmarks(next, pieceSize) : [];
  }

  function add(entry: NewBookmark, tags: readonly string[] = []): void {
    commit(addBookmark(bookmarks.value, entry, tags));
  }

  function remove(id: string): void {
    commit(removeBookmark(bookmarks.value, id));
  }

  function rename(id: string, name: string): void {
    commit(renameBookmark(bookmarks.value, id, name));
  }

  function toggleFavorite(id: string): void {
    commit(toggleBookmarkFavorite(bookmarks.value, id));
  }

  function tag(id: string, name: string): void {
    commit(addTag(bookmarks.value, id, name));
  }

  function untag(id: string, name: string): void {
    commit(removeTag(bookmarks.value, id, name));
  }

  const canAdd = computed(() => bookmarks.value.length < MAX_BOOKMARKS);
  // Every tag the notebook holds, which is every word its bookmarks wear: a tag
  // is born on the first one to wear it and goes with the last one to drop it,
  // so there is nothing to create and nothing to clean up.
  const tags = computed(() => allTags(bookmarks.value));

  return {
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
  };
}
