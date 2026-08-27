import { computed, ref } from "vue";
import { LATEST_VERSION } from "../data/releases";
import { hasUnseenRelease, readSeenVersion, writeSeenVersion } from "../data/updatesSeen";

// A browser with nothing stored has seen the current release, not none of them:
// treating absence as unread marks the settings menu new on a first-time
// player's first frame, the one player for whom nothing is. The cost is that a
// release only ever reaches players who were already here before it shipped.
const seen = ref<string | null>(readSeenVersion());
if (seen.value === null) {
  seen.value = LATEST_VERSION;
  writeSeenVersion(LATEST_VERSION);
}

const unseen = computed(() => hasUnseenRelease(seen.value, LATEST_VERSION));

export function useUpdatesSeen() {
  function markSeen(): void {
    if (seen.value === LATEST_VERSION) return;
    seen.value = LATEST_VERSION;
    writeSeenVersion(LATEST_VERSION);
  }
  return { unseen, markSeen };
}
