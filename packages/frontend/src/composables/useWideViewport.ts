import { readonly, ref } from "vue";

// The HUD's one phone/desktop split, mirroring the `@media (max-width: 680px)`
// breakpoint the panels style themselves with. One module-level listener shared
// by every reader, and read in JS rather than in CSS wherever an element must
// not exist at all on a phone, so its keyboard shortcuts and its reactive work
// go with it instead of running behind a `display: none`.
const media = window.matchMedia("(min-width: 681px)");
const wide = ref(media.matches);

media.addEventListener("change", (ev) => {
  wide.value = ev.matches;
});

export function useWideViewport() {
  return { wide: readonly(wide) };
}
