<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import BrandMark from "../components/BrandMark.vue";
import CountdownTimer from "../components/CountdownTimer.vue";
import { useMode } from "../composables/useMode";
import { landingUrl, interestedUrl } from "../data/spectatorUrl";

const router = useRouter();
const { setMode } = useMode();

const INTERESTED_KEY = "mpp.interested";

const eventStartsAt = ref(0);
const interested = ref(false);
const count = ref<number | null>(null);
const submitting = ref(false);

type LandingData = { eventStartsAt: number; interested: { count: number; me: boolean } };
type InterestedData = { count: number; me: boolean };

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

function enterCanvas(): void {
  setMode("spectator");
  void router.push("/play");
}

async function markInterested(): Promise<void> {
  if (interested.value || submitting.value) return;
  submitting.value = true;
  try {
    const res = await fetch(interestedUrl(), { method: "POST" });
    if (!res.ok) return;
    const data = (await res.json()) as InterestedData;
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
  if (count.value === 0) return "Be the first to follow along";
  const noun = count.value === 1 ? "person" : "people";
  return `${count.value.toLocaleString()} ${noun} interested`;
}

onMounted(async () => {
  interested.value = cachedInterested();
  try {
    const res = await fetch(landingUrl());
    if (!res.ok) return;
    const data = (await res.json()) as LandingData;
    eventStartsAt.value = data.eventStartsAt;
    count.value = data.interested.count;
    interested.value = data.interested.me;
    if (data.interested.me) rememberInterested();
  } catch {
    // the landing still works offline: countdown shows its placeholder and the
    // interested button can be retried
  }
});
</script>

<template>
  <div class="landing">
    <header class="landing-top">
      <span class="brand">
        <BrandMark />
        <span class="brand-name">Million Piece <em>Puzzle</em></span>
      </span>
    </header>

    <main class="hero">
      <h1>Million Piece Puzzle</h1>
      <p class="tagline">
        One million pieces on a single shared canvas. Watch the picture come together, or join in
        and place your piece of it.
      </p>

      <CountdownTimer class="hero-countdown" :event-starts-at="eventStartsAt" />

      <div class="actions">
        <button type="button" class="cta primary" @click="enterCanvas">Enter the canvas</button>
        <button
          v-if="!interested"
          type="button"
          class="cta secondary"
          :disabled="submitting"
          @click="markInterested"
        >
          I'm interested
        </button>
        <span v-else class="interested-badge">You're on the list</span>
      </div>

      <p v-if="count !== null" class="interest-count">{{ interestLabel() }}</p>
    </main>

    <footer class="landing-foot">
      <span class="legal-links">
        <RouterLink to="/privacy">Privacy</RouterLink>
        <RouterLink to="/legal">Legal notice</RouterLink>
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
  max-width: 720px;
  padding: 0 24px;
  text-align: center;
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
.hero-countdown {
  margin-bottom: 40px;
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
.cta.secondary {
  background: transparent;
  color: var(--ink-2);
}
.cta.secondary:hover {
  border-color: var(--ink-3);
  color: var(--ink);
}
.cta:disabled {
  opacity: 0.6;
  cursor: default;
}
.interested-badge {
  display: inline-flex;
  align-items: center;
  padding: 12px 22px;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}
.interest-count {
  margin: 16px 0 0;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-4);
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
