import { ref, readonly } from "vue";

const open = ref(false);

export function useOptionsModal() {
  return {
    open: readonly(open),
    show: () => {
      open.value = true;
    },
    hide: () => {
      open.value = false;
    },
  };
}
