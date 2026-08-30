import { computed, ref, shallowRef } from "vue";
import {
  MAX_FLAGS,
  addFlag,
  moveFlag,
  readFlags,
  recolorFlag,
  removeFlag,
  writeFlags,
  type BoardFlag,
} from "../data/boardFlags";
import type { FlagDropTargetSource } from "../canvas/flagDrop";

// Personal viewport flags, shared by the HUD bar, the popover, the canvas layer
// and both overviews. Client-only and per browser: the list is keyed by puzzle
// id, so a board switch never resurrects coordinates from another puzzle.
const flags = ref<BoardFlag[]>([]);
const selectedId = ref<string | null>(null);
const puzzleId = ref<string | null>(null);

// Pull-based bridge for the drop that sends a dragged cluster to a flag: the
// stage measures the buttons when a drag starts (the bar cannot relayout under a
// held pointer) and hit-tests the pointer against them itself. Registered by the
// bottom-center bar alone, which is what keeps the canvas and overview markers out
// of the gesture, and answers in client coordinates, the one frame the DOM bar
// and the canvas both speak.
const dropTargetSource = shallowRef<FlagDropTargetSource | null>(null);
const dropHoverId = ref<string | null>(null);

function commit(next: BoardFlag[]): void {
  flags.value = next;
  if (puzzleId.value) writeFlags(puzzleId.value, next);
}

export function useBoardFlags() {
  function setPuzzle(next: string | null): void {
    if (puzzleId.value === next) return;
    puzzleId.value = next;
    selectedId.value = null;
    flags.value = next ? readFlags(next) : [];
  }

  function add(worldX: number, worldY: number): void {
    commit(addFlag(flags.value, worldX, worldY));
  }

  function remove(id: string): void {
    if (selectedId.value === id) selectedId.value = null;
    commit(removeFlag(flags.value, id));
  }

  function move(id: string, worldX: number, worldY: number): void {
    commit(moveFlag(flags.value, id, worldX, worldY));
  }

  function recolor(id: string, color: number): void {
    commit(recolorFlag(flags.value, id, color));
  }

  function select(id: string | null): void {
    selectedId.value = id;
  }

  function setDropTargetSource(next: FlagDropTargetSource | null): void {
    dropTargetSource.value = next;
    if (!next) dropHoverId.value = null;
  }

  function setDropHover(id: string | null): void {
    dropHoverId.value = id;
  }

  const canAdd = computed(() => flags.value.length < MAX_FLAGS);
  const selected = computed(() => flags.value.find((f) => f.id === selectedId.value) ?? null);

  return {
    flags,
    selected,
    selectedId,
    canAdd,
    dropTargetSource,
    dropHoverId,
    setPuzzle,
    add,
    remove,
    move,
    recolor,
    select,
    setDropTargetSource,
    setDropHover,
  };
}
