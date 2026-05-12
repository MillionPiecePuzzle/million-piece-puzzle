import { ref, readonly } from "vue";

export type Mode = "spectator" | "contributor";

const mode = ref<Mode>("spectator");

export function useMode() {
  function setMode(next: Mode) {
    mode.value = next;
  }
  return { mode: readonly(mode), setMode };
}
