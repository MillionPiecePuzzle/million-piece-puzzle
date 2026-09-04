<script setup lang="ts">
import { computed } from "vue";
import type { BookmarkBadge } from "../data/bookmarks";
import { badgeSquareLevel, dziTileImages, type DziInfo } from "../canvas/dziTiles";

// What stands for a spot, drawn at whatever size it is given: one piece tile, or
// the square of the board the player traced, laid out from the one to four
// pyramid tiles it touches and cropped to the box. The level follows the size on
// screen, so the same badge is sharp in a 40px row and under the pointer at 192.
const props = defineProps<{
  badge: BookmarkBadge;
  size: number;
  assetBase: string;
  tilesPath: string;
  dzi: DziInfo | null;
  lazy?: boolean;
}>();

const tiles = computed(() => {
  const info = props.dzi;
  const badge = props.badge;
  if (!info || badge.kind !== "area") return [];
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
</script>

<template>
  <span class="art">
    <img
      v-if="badge.kind === 'piece'"
      class="piece"
      :src="assetBase + badge.file"
      alt=""
      crossorigin="anonymous"
      :loading="lazy ? 'lazy' : 'eager'"
      decoding="async"
    />
    <img
      v-for="tile in tiles"
      v-else
      :key="tile.url"
      class="tile"
      :src="tile.url"
      :style="tile.style"
      alt=""
      crossorigin="anonymous"
      :loading="lazy ? 'lazy' : 'eager'"
      decoding="async"
    />
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
/* A piece tile is its own cell plus a margin a side that only its tabs reach
   into: measured on the prod board, a piece spans 63% of its tile with blanks all
   round and 92% with tabs all round. This is the zoom that lets the quiet ones
   read at 40px, and it costs a fully tabbed piece about a third of one tab tip. */
.piece {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transform: scale(1.2);
}
</style>
