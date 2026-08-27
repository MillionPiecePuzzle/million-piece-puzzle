import { readonly, ref } from "vue";

// The HUD's one full/compact split, mirroring the `@media (max-width: 680px),
// (max-height: 480px)` breakpoint the panels style themselves with. Height
// counts as much as width: a phone held sideways is under 430px tall, which has
// room for the board and nothing else. One module-level listener shared by every
// reader, and read in JS rather than in CSS wherever an element must not exist
// at all on a small screen, so its keyboard shortcuts and its reactive work go
// with it instead of running behind a `display: none`.
const media = window.matchMedia("(max-width: 680px), (max-height: 480px)");
const compact = ref(media.matches);

media.addEventListener("change", (ev) => {
  compact.value = ev.matches;
});

export function useCompactViewport() {
  return { compact: readonly(compact) };
}
