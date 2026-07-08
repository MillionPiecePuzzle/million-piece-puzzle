<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { usePuzzleSession, type ActivityEntry } from "../composables/usePuzzleSession";
import { useRelativeTime } from "../composables/useRelativeTime";
import { useLocaleFormat } from "../i18n/format";

const { t } = useI18n();
const { formatNumber } = useLocaleFormat();
const { activity } = usePuzzleSession();
const { relativeTime } = useRelativeTime();

// Indefinite article matching how the number is read aloud: "eight", "eleven",
// "eighteen", "eighty...", "eight hundred...", "eight thousand..." all lead with a
// vowel sound and take "an"; everything else takes "a". Only the leading spoken
// group decides, so divide down to it (e.g. 8000 -> 8 "eight thousand").
function indefiniteArticle(n: number): string {
  let lead = Math.abs(Math.trunc(n));
  while (lead >= 1000) lead = Math.floor(lead / 1000);
  const hundreds = Math.floor(lead / 100);
  if (hundreds === 8) return "an";
  if (hundreds !== 0) return "a";
  const r = lead % 100;
  return r === 8 || r === 11 || r === 18 || (r >= 80 && r <= 89) ? "an" : "a";
}

// The English indefinite article is passed to the message and ignored by locales
// whose cluster phrase carries a fixed article.
function cluster(count: number): string {
  return t("activityPanel.cluster", { article: indefiniteArticle(count), n: formatNumber(count) });
}

// A place reports the placed group (one piece or an N-piece cluster). A snap
// reports the resulting cluster (always >= 2): two single pieces read "two pieces
// together", anything larger reads as the cluster it formed.
function objectPhrase(entry: ActivityEntry): string {
  if (entry.kind === "snap") {
    return entry.count === 2 ? t("activityPanel.twoPieces") : cluster(entry.count);
  }
  return entry.count === 1 ? t("activityPanel.piece") : cluster(entry.count);
}

// The whole verb-plus-object phrase comes from one message so each language can
// place the verb where its grammar needs it (e.g. German verb-final).
function lineRest(entry: ActivityEntry): string {
  const object = objectPhrase(entry);
  return entry.kind === "place"
    ? t("activityPanel.placedLine", { object })
    : t("activityPanel.connectedLine", { object });
}
</script>

<template>
  <aside class="panel ticker">
    <h3>{{ t("common.activity") }}</h3>
    <ul v-if="activity.length > 0">
      <li v-for="entry in activity" :key="entry.id">
        <span class="msg"
          ><b>{{ entry.actor }}</b> {{ lineRest(entry) }}</span
        >
        <span class="ts">{{ relativeTime(entry.at) }}</span>
      </li>
    </ul>
    <p v-else class="empty">{{ t("common.noActivity") }}</p>
  </aside>
</template>

<style scoped>
.ticker {
  bottom: 16px;
  left: 16px;
  width: 340px;
  padding: 12px 14px;
}
.ticker h3 {
  margin-bottom: 8px;
}
.ticker ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ticker li {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--ink-2);
}
.msg b {
  font-weight: 500;
  color: var(--ink);
}
.ts {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-4);
  white-space: nowrap;
}
.empty {
  margin: 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
</style>
