import { computed, ref } from "vue";
import {
  HUD_PANEL_IDS,
  isPanelVisible,
  readDisplaySettings,
  writeDisplaySettings,
  type DisplaySettings,
  type HudPanelId,
} from "../data/displaySettings";
import { useWideViewport } from "./useWideViewport";

// One module-level source for the display preferences, read once per page load:
// the options menu writes them, the canvas watches them.
const settings = ref<DisplaySettings>(readDisplaySettings());

const { wide } = useWideViewport();

// What the HUD draws: a stored choice where the player made one, the viewport's
// own default everywhere else. The rails and the options menu read the same map,
// so a switch always shows the state the board is in.
const visiblePanels = computed(() => {
  const visible = {} as Record<HudPanelId, boolean>;
  for (const id of HUD_PANEL_IDS) visible[id] = isPanelVisible(settings.value, id, wide.value);
  return visible;
});

export function useDisplaySettings() {
  function setReferenceUnderlay(on: boolean): void {
    if (settings.value.referenceUnderlay === on) return;
    settings.value = { ...settings.value, referenceUnderlay: on };
    writeDisplaySettings(settings.value);
  }
  function setPanel(panel: HudPanelId, on: boolean): void {
    if (settings.value.panels[panel] === on) return;
    settings.value = { ...settings.value, panels: { ...settings.value.panels, [panel]: on } };
    writeDisplaySettings(settings.value);
  }
  return { settings, visiblePanels, setReferenceUnderlay, setPanel };
}
