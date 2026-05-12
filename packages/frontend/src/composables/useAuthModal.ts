import { ref, readonly } from "vue";

const open = ref(false);

export function useAuthModal() {
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
