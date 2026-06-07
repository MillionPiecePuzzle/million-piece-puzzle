<script setup lang="ts">
defineProps<{ title: string; updated: string }>();
</script>

<template>
  <div class="legal">
    <article class="legal-inner">
      <RouterLink to="/" class="back">&larr; Back to home</RouterLink>
      <h1>{{ title }}</h1>
      <p class="updated">Last updated: {{ updated }}</p>
      <div class="doc">
        <slot />
      </div>
    </article>
  </div>
</template>

<style scoped>
.legal {
  min-height: 100%;
  background: radial-gradient(circle at 50% 35%, #faf7f0 0%, #efeadd 70%, #e7e1d1 100%);
  padding: 48px 24px 72px;
}
.legal-inner {
  max-width: 680px;
  margin: 0 auto;
}
.back {
  display: inline-block;
  margin-bottom: 28px;
  font-size: 13px;
  color: var(--accent);
  transition: opacity 150ms ease;
}
.back:hover {
  opacity: 0.7;
}
h1 {
  margin: 0;
  font-family: var(--serif);
  font-weight: 500;
  font-size: clamp(32px, 5vw, 44px);
  letter-spacing: -0.02em;
  color: var(--accent);
}
.updated {
  margin: 6px 0 0;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.doc :deep(h2) {
  margin: 36px 0 10px;
  font-family: var(--serif);
  font-weight: 500;
  font-size: 19px;
  letter-spacing: -0.01em;
  color: var(--ink);
}
.doc :deep(p) {
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
  color: var(--ink-3);
}
.doc :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
