import { ref } from "vue";
import {
  readDisplaySettings,
  writeDisplaySettings,
  type DisplaySettings,
} from "../data/displaySettings";

// One module-level source for the display preferences, read once per page load:
// the options menu writes them, the canvas watches them.
const settings = ref<DisplaySettings>(readDisplaySettings());

export function useDisplaySettings() {
  function setReferenceUnderlay(on: boolean): void {
    if (settings.value.referenceUnderlay === on) return;
    settings.value = { ...settings.value, referenceUnderlay: on };
    writeDisplaySettings(settings.value);
  }
  return { settings, setReferenceUnderlay };
}
