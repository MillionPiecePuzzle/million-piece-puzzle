<script setup lang="ts">
import { computed } from "vue";
import type { BookmarkBadge } from "../data/bookmarks";
import { badgeSquareLevel, dziTileImages, type DziInfo } from "../canvas/dziTiles";

// What stands for a spot, drawn at whatever size it is given: the square of the
// board the player traced, laid out from the one to four pyramid tiles it touches
// and cropped to the box. The level follows the size on screen, so the same badge
// is sharp in a 40px row and under the pointer at 192.
//
// A spot with no picture under it draws the default badge instead, a mark rather
// than a photograph: an entry off the picture (bare ground, where most of the
// pieces are scattered) wears no square at all, and one that does can still name
// a place the pyramid does not cover, which the tiles would answer with holes.
const props = defineProps<{
  badge: BookmarkBadge | null;
  size: number;
  assetBase: string;
  tilesPath: string;
  dzi: DziInfo | null;
  lazy?: boolean;
}>();

// Whether the square this badge names has any of the picture in it at all, read
// against the pyramid's own dimensions, which is what the tiles are cut from.
const onPicture = computed(() => {
  const info = props.dzi;
  const badge = props.badge;
  if (!info || !badge) return false;
  return (
    badge.x + badge.size > 0 &&
    badge.y + badge.size > 0 &&
    badge.x < info.width &&
    badge.y < info.height
  );
});

const tiles = computed(() => {
  const info = props.dzi;
  const badge = props.badge;
  if (!info || !badge || !onPicture.value) return [];
  const level = badgeSquareLevel(info, badge.size, props.size * (window.devicePixelRatio || 1));
  const rect = {
    minX: badge.x,
    minY: badge.y,
    maxX: badge.x + badge.size,
    maxY: badge.y + badge.size,
  };
  const scale = props.size / badge.size;
  return dziTileImages(info, level, rect, props.tilesPath).map((tile) => ({
    url: props.assetBase + tile.url,
    style: {
      left: `${(tile.worldRect.minX - badge.x) * scale}px`,
      top: `${(tile.worldRect.minY - badge.y) * scale}px`,
      width: `${(tile.worldRect.maxX - tile.worldRect.minX) * scale}px`,
      height: `${(tile.worldRect.maxY - tile.worldRect.minY) * scale}px`,
    },
  }));
});

// The default badge is drawn, never fetched, so it costs nothing and is the same
// mark at 40px and at 192: a point on bare ground, which is what the entry is.
const showDefault = computed(() => props.dzi !== null && !onPicture.value);
</script>

<template>
  <span class="art">
    <img
      v-for="tile in tiles"
      :key="tile.url"
      class="tile"
      :src="tile.url"
      :style="tile.style"
      alt=""
      crossorigin="anonymous"
      :loading="lazy ? 'lazy' : 'eager'"
      decoding="async"
    />
    <svg v-if="showDefault" class="mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.6" />
      <path
        d="M12 3.4v3.4M12 17.2v3.4M3.4 12h3.4M17.2 12h3.4"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
  </span>
</template>

<style scoped>
.art {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.tile {
  position: absolute;
  display: block;
  /* The pyramid gives neighbouring tiles a shared margin, so they are placed
     overlapping by design and the seam between two is the same pixels twice. */
  max-width: none;
}
/* Held to a share of the box rather than to a size, so the one mark reads in a
   row and under the pointer. */
.mark {
  position: absolute;
  inset: 25%;
  width: 50%;
  height: 50%;
  color: var(--ink-4);
}
</style>
