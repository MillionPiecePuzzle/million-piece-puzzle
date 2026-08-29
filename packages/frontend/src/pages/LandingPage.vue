<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import type { ActivityItem, LeaderboardEntry } from "@mpp/shared";
import BrandMark from "../components/BrandMark.vue";
import CountdownTimer from "../components/CountdownTimer.vue";
import LanguageSwitcher from "../components/LanguageSwitcher.vue";
import ContributorsRow from "../components/ContributorsRow.vue";
import { useCountdown } from "../composables/useCountdown";
import { useRelativeTime } from "../composables/useRelativeTime";
import { flooredPercent, useLocaleFormat } from "../i18n/format";
import {
  backendRetryDelayMs,
  interestedUrl,
  loadLanding,
  type InterestState,
  type LandingData,
} from "../data/landing";
import { toContributorsRows } from "../data/contributors";

const router = useRouter();
const { t } = useI18n();
const { formatNumber, formatPercent, formatDate } = useLocaleFormat();
const { relativeTime } = useRelativeTime();

const INTERESTED_KEY = "mpp.interested";

const eventStartsAt = ref(0);
const interested = ref(false);
const count = ref<number | null>(null);
const submitting = ref(false);

const status = ref<"active" | "completed">("active");
const progress = ref<{ locked: number; total: number }>({ locked: 0, total: 0 });
const leaderboard = ref<LeaderboardEntry[]>([]);
const activity = ref<ActivityItem[]>([]);
const completion = ref<{ at: number; startedAt: number } | null>(null);
// The backend is not answering. The landing itself is on Cloudflare Pages and
// stays up regardless, so it says the puzzle is down instead of rendering an
// empty board with a Play button that leads nowhere.
const unavailable = ref(false);

// Before the start the landing counts down; once the board is done it shows the
// recap; in between it shows live progress. Completion wins over the timer so a
// finished puzzle never falls back to the countdown.
const { launched, scheduled, parts } = useCountdown(eventStartsAt);
const phase = computed<"scheduled" | "live" | "completed">(() => {
  if (status.value === "completed") return "completed";
  return launched.value ? "live" : "scheduled";
});

// Three decimals so the readout still moves at the scale it counts in: on the
// 1M board one step is 10 pieces, where a second decimal would sit on 0.00%
// for the first hundred and on 99.99% for the last hundred.
const PROGRESS_DECIMALS = 3;

const progressPct = computed(() =>
  flooredPercent(progress.value.locked, progress.value.total, PROGRESS_DECIMALS),
);

// A finished board reads 100%, not 100.000%: the decimals earn their place only
// while the number is still moving.
const progressPctLabel = computed(() =>
  formatPercent(progressPct.value, progressPct.value === 100 ? 0 : PROGRESS_DECIMALS),
);

// Anonymous viewer, so no "you" row to highlight: pass a null user id.
const liveLeaders = computed(() => toContributorsRows(leaderboard.value, null).slice(0, 6));
const finalLeaders = computed(() => toContributorsRows(leaderboard.value, null).slice(0, 10));

const activityLines = computed(() =>
  activity.value.map((item) => ({
    id: item.id,
    actor: item.pseudo ?? t("landing.someone"),
    rest: item.anchored
      ? t("landing.placed", { pieces: piecePhrase(item.droppedSize) })
      : t("landing.connected", { pieces: piecePhrase(item.mergedSize) }),
    at: item.at,
  })),
);

function piecePhrase(n: number): string {
  return t("landing.pieces", n, { named: { n: formatNumber(n) } });
}

// Event duration: scheduled start to the final placement, falling back to the
// first placement when no start was set (dev, eventStartsAt 0).
function formatDuration(c: { at: number; startedAt: number }): string {
  const from = eventStartsAt.value > 0 ? eventStartsAt.value : c.startedAt;
  const totalSec = Math.max(0, Math.round((c.at - from) / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}${t("units.d")}`);
  if (hours > 0 || days > 0) parts.push(`${hours}${t("units.h")}`);
  parts.push(`${minutes}${t("units.m")}`);
  return parts.join(" ");
}

function cachedInterested(): boolean {
  try {
    return localStorage.getItem(INTERESTED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberInterested(): void {
  try {
    localStorage.setItem(INTERESTED_KEY, "1");
  } catch {
    // best effort: the server stays the source of truth
  }
}

function enterBoard(): void {
  // Guest-first: the canvas mints a guest on arrival (or reuses an existing
  // session), so the landing CTA just navigates straight to /play.
  void router.push("/play");
}

async function markInterested(): Promise<void> {
  if (interested.value || submitting.value) return;
  submitting.value = true;
  try {
    const res = await fetch(interestedUrl(), { method: "POST" });
    if (!res.ok) return;
    const data = (await res.json()) as InterestState;
    count.value = data.count;
    interested.value = true;
    rememberInterested();
  } catch {
    // leave the button available to retry on a transient failure
  } finally {
    submitting.value = false;
  }
}

function interestLabel(): string {
  if (count.value === null) return "";
  if (count.value === 0) return t("landing.beFirst");
  return t("landing.interestCount", count.value, { named: { n: formatNumber(count.value) } });
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;

function applyLanding(data: LandingData): void {
  eventStartsAt.value = data.eventStartsAt;
  count.value = data.interested.count;
  interested.value = data.interested.me;
  if (data.interested.me) rememberInterested();
  status.value = data.status;
  progress.value = data.progress;
  leaderboard.value = data.leaderboard;
  activity.value = data.activity;
  completion.value = data.completion ?? null;
}

// loadLanding never rejects: a failed fetch resolves to null, and only successes
// are cached, so retrying it is also how the page notices the server is back.
async function refresh(): Promise<void> {
  const data = await loadLanding();
  if (!data) {
    unavailable.value = true;
    retryTimer = setTimeout(() => void refresh(), backendRetryDelayMs());
    return;
  }
  unavailable.value = false;
  applyLanding(data);
}

onMounted(() => {
  interested.value = cachedInterested();
  void refresh();
});

onUnmounted(() => {
  if (retryTimer !== null) clearTimeout(retryTimer);
});
</script>

<template>
  <div class="landing">
    <header class="landing-top">
      <span class="brand">
        <BrandMark />
        <span class="brand-name">Million Piece <em>Puzzle</em></span>
      </span>
      <LanguageSwitcher />
    </header>

    <main class="hero">
      <div class="hero-top">
        <h1>Million Piece Puzzle</h1>
        <p class="tagline">{{ t("landing.tagline") }}</p>

        <div v-if="unavailable" class="hero-feature unavailable">
          <p class="unavailable-heading">{{ t("maintenance.heading") }}</p>
          <p class="unavailable-body">{{ t("maintenance.body") }}</p>
        </div>

        <CountdownTimer
          v-else-if="phase === 'scheduled'"
          class="hero-feature"
          :scheduled="scheduled"
          :parts="parts"
        />

        <div v-else-if="phase === 'live'" class="hero-feature progress">
          <p class="progress-figures">
            <span class="progress-locked">{{ formatNumber(progress.locked) }}</span>
            <span class="progress-total">{{
              t("landing.piecesLockedSuffix", { n: formatNumber(progress.total) })
            }}</span>
          </p>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
          </div>
          <p class="progress-pct">
            {{ t("landing.pctComplete", { p: progressPctLabel }) }}
          </p>
        </div>

        <div v-else class="hero-feature completed">
          <p class="completed-word">{{ t("landing.completed") }}</p>
          <p v-if="completion" class="completed-meta">
            {{ formatDate(completion.at) }} <span class="dot" aria-hidden="true">·</span>
            {{ t("landing.solvedIn", { duration: formatDuration(completion) }) }}
          </p>
        </div>

        <div v-if="!unavailable" class="actions">
          <button
            v-if="phase !== 'scheduled'"
            type="button"
            class="cta primary"
            @click="enterBoard"
          >
            {{ t("landing.enterBoard") }}
          </button>
          <button
            v-else-if="!interested"
            type="button"
            class="cta primary"
            :disabled="submitting"
            @click="markInterested"
          >
            {{ t("landing.interested") }}
          </button>
        </div>

        <p v-if="phase === 'scheduled' && interested && count !== null" class="interest-count">
          {{ interestLabel() }}
        </p>
      </div>

      <section v-if="phase === 'live' && !unavailable" class="live-panels">
        <div class="board-card">
          <h3>{{ t("landing.liveActivity") }}</h3>
          <ul v-if="activityLines.length > 0" class="activity-list">
            <li v-for="line in activityLines" :key="line.id">
              <span class="msg"
                ><b>{{ line.actor }}</b> {{ line.rest }}</span
              >
              <span class="ts">{{ relativeTime(line.at) }}</span>
            </li>
          </ul>
          <p v-else class="empty">{{ t("activity.empty") }}</p>
        </div>
        <div class="board-card">
          <h3>{{ t("contributors.title") }}</h3>
          <ol v-if="liveLeaders.length > 0" class="contributors-list">
            <ContributorsRow
              v-for="row in liveLeaders"
              :key="row.rank"
              :row="row"
              rank-width="18px"
              :show-you-tag="false"
            />
          </ol>
          <p v-else class="empty">{{ t("contributors.empty") }}</p>
        </div>
      </section>

      <section v-else-if="phase === 'completed'" class="final-board board-card">
        <h3>{{ t("contributors.title") }}</h3>
        <ol v-if="finalLeaders.length > 0" class="contributors-list">
          <ContributorsRow
            v-for="row in finalLeaders"
            :key="row.rank"
            :row="row"
            :show-you-tag="false"
          />
        </ol>
        <p v-else class="empty">{{ t("landing.noStandingsFinal") }}</p>
      </section>
    </main>

    <footer class="landing-foot">
      <span class="legal-links">
        <RouterLink to="/privacy">{{ t("footer.privacy") }}</RouterLink>
        <RouterLink to="/legal">{{ t("footer.legal") }}</RouterLink>
      </span>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  min-height: 100%;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: radial-gradient(circle at 50% 35%, #faf7f0 0%, #efeadd 70%, #e7e1d1 100%);
}
.landing-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.brand-name {
  font-family: var(--serif);
  font-weight: 500;
  font-size: 18px;
  letter-spacing: -0.01em;
}
.brand-name em {
  font-style: italic;
  font-weight: 400;
  color: var(--ink-3);
}
.hero {
  align-self: center;
  justify-self: center;
  width: 100%;
  padding: 48px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 48px;
}
.hero-top {
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
h1 {
  margin: 0 0 12px;
  font-family: var(--serif);
  font-weight: 500;
  font-size: clamp(40px, 6vw, 64px);
  line-height: 1.05;
  letter-spacing: -0.02em;
}
.tagline {
  margin: 0 0 40px;
  max-width: 480px;
  color: var(--ink-3);
  font-size: 15px;
  line-height: 1.5;
}
.hero-feature {
  margin-bottom: 40px;
  width: 100%;
}
.progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 460px;
}
.progress-figures {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}
.progress-locked {
  font-family: var(--mono);
  font-size: clamp(36px, 7vw, 60px);
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}
.progress-total {
  font-family: var(--mono);
  font-size: 13px;
  letter-spacing: 0.04em;
  color: var(--ink-4);
}
.progress-track {
  width: 100%;
  height: 8px;
  border-radius: var(--radius-pill);
  background: rgba(21, 20, 15, 0.08);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--accent);
  transition: width 400ms ease;
}
.progress-pct {
  margin: 0;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.completed {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.unavailable-heading {
  margin: 0 0 10px;
  font-family: var(--serif);
  font-size: clamp(24px, 4vw, 34px);
  color: var(--ink);
}
.unavailable-body {
  margin: 0;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--ink-3);
}
.completed-word {
  margin: 0;
  font-family: var(--mono);
  font-size: clamp(40px, 8vw, 72px);
  line-height: 1;
  letter-spacing: 0.12em;
  color: var(--accent);
}
.completed-meta {
  margin: 0;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}
.completed-meta .dot {
  color: var(--ink-4);
  padding: 0 4px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
}
.cta {
  padding: 12px 22px;
  border-radius: var(--radius-pill);
  font-size: 14px;
  letter-spacing: -0.005em;
  border: 1px solid var(--line);
  transition:
    background 160ms ease,
    color 160ms ease,
    border-color 160ms ease;
  cursor: pointer;
}
.cta.primary {
  background: var(--ink);
  color: var(--ground);
  border-color: var(--ink);
}
.cta.primary:hover {
  background: var(--ink-2);
}
.cta:disabled {
  opacity: 0.6;
  cursor: default;
}
.interest-count {
  margin: 16px 0 0;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.board-card {
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-panel);
  padding: 16px 16px 12px;
  text-align: left;
}
.board-card h3 {
  margin: 0 0 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.live-panels {
  width: 100%;
  max-width: 760px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.activity-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.activity-list li {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--ink-2);
}
.activity-list .msg b {
  font-weight: 500;
  color: var(--ink);
}
.activity-list .ts {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-4);
  white-space: nowrap;
}
.contributors-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.final-board {
  width: 100%;
  max-width: 560px;
}
.empty {
  margin: 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
}
@media (max-width: 640px) {
  .live-panels {
    grid-template-columns: 1fr;
  }
}
.landing-foot {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-4);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.legal-links {
  display: inline-flex;
  gap: 16px;
}
.legal-links a {
  color: var(--ink-4);
  transition: color 150ms ease;
}
.legal-links a:hover {
  color: var(--ink-2);
}
</style>
