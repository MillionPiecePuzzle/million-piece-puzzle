import { ref, readonly } from "vue";

export type Mode = "pending" | "contributor";

const mode = ref<Mode>("pending");

export function useMode() {
  function setMode(next: Mode) {
    mode.value = next;
  }
  return { mode: readonly(mode), setMode };
}
