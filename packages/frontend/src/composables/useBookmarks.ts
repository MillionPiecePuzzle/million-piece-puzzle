import { computed, ref } from "vue";
import {
  MAX_BOOKMARKS,
  addBookmark,
  readBookmarks,
  removeBookmark,
  writeBookmarks,
  type Bookmark,
  type NewBookmark,
} from "../data/bookmarks";

// The player's bookmark notebook, shared by the menu row and the list. Per
// browser and keyed by puzzle id like the personal flags, so a board switch
// never resurrects coordinates from another puzzle.
const bookmarks = ref<Bookmark[]>([]);
const puzzleId = ref<string | null>(null);

function commit(next: Bookmark[]): void {
  bookmarks.value = next;
  if (puzzleId.value) writeBookmarks(puzzleId.value, next);
}

export function useBookmarks() {
  function setPuzzle(next: string | null): void {
    if (puzzleId.value === next) return;
    puzzleId.value = next;
    bookmarks.value = next ? readBookmarks(next) : [];
  }

  function add(entry: NewBookmark): void {
    commit(addBookmark(bookmarks.value, entry));
  }

  function remove(id: string): void {
    commit(removeBookmark(bookmarks.value, id));
  }

  const canAdd = computed(() => bookmarks.value.length < MAX_BOOKMARKS);

  return { bookmarks, canAdd, setPuzzle, add, remove };
}
