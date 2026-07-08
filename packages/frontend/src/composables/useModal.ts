import { readonly, ref, type Ref } from "vue";

// Shared open/mode/show/hide store behind every modal composable. Each caller
// invokes this once at module scope so the returned refs are a singleton
// shared by every component that imports that modal's composable.
export function useModal(): {
  open: Readonly<Ref<boolean>>;
  mode: Readonly<Ref<undefined>>;
  show: () => void;
  hide: () => void;
};
export function useModal<TMode>(defaultMode: TMode): {
  open: Readonly<Ref<boolean>>;
  mode: Readonly<Ref<TMode>>;
  show: (next: TMode) => void;
  hide: () => void;
};
export function useModal<TMode = undefined>(defaultMode?: TMode) {
  const open = ref(false);
  const mode = ref(defaultMode) as Ref<TMode>;

  return {
    open: readonly(open),
    mode: readonly(mode),
    show: (next?: TMode) => {
      if (next !== undefined) mode.value = next;
      open.value = true;
    },
    hide: () => {
      open.value = false;
    },
  };
}
