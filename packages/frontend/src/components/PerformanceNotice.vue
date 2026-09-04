<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRenderHealth, useFrameRateProbe } from "../composables/useRenderHealth";

const { t } = useI18n();
const { noticeVisible, dismissNotice } = useRenderHealth();
useFrameRateProbe();

const showTips = ref(false);
const band = ref<HTMLElement | null>(null);

// The band is chrome, not an overlay: the stage below it starts under whatever
// height it ends up at, so a wrapped line or the open tips move the board down
// rather than covering it. Measured rather than hardcoded, since that height is
// the text's, in four languages and at every width.
const observer = new ResizeObserver(() => {
  const el = band.value;
  if (el) document.documentElement.style.setProperty("--notice-h", `${el.offsetHeight}px`);
});

watch(band, (el, previous) => {
  if (previous) observer.unobserve(previous);
  if (el) observer.observe(el);
  else document.documentElement.style.removeProperty("--notice-h");
});

onBeforeUnmount(() => {
  observer.disconnect();
  document.documentElement.style.removeProperty("--notice-h");
});
</script>

<template>
  <Transition name="perf">
    <aside v-if="noticeVisible" ref="band" class="perf-notice" role="status">
      <div class="row">
        <svg
          class="glyph"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3.6 22 20.4H2z" />
          <path d="M12 9.6v5" />
          <path d="M12 17.6h.01" />
        </svg>
        <p class="message">
          <span class="label">{{ t("perfNotice.label") }}</span>
          {{ t("perfNotice.message") }}
        </p>
        <button type="button" class="more" :aria-expanded="showTips" @click="showTips = !showTips">
          {{ showTips ? t("perfNotice.hideTips") : t("perfNotice.showTips") }}
        </button>
        <button
          type="button"
          class="close"
          :title="t('perfNotice.dismiss')"
          :aria-label="t('perfNotice.dismiss')"
          @click="dismissNotice"
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <ul v-if="showTips" class="tips">
        <li>{{ t("perfNotice.tipAcceleration") }}</li>
        <li>{{ t("perfNotice.tipTabs") }}</li>
      </ul>
    </aside>
  </Transition>
</template>

<style scoped>
/* Dark against the cream board and its parchment panels, sharing the toast's
   "something is wrong" family rather than the HUD's: this has to read as the
   app talking about itself, not as another panel. Under the topbar's z-index,
   so a menu opened up there still wins. */
.perf-notice {
  position: fixed;
  top: 52px;
  left: 0;
  right: 0;
  z-index: 30;
  padding: 9px 16px;
  background: linear-gradient(180deg, rgba(44, 34, 22, 0.96), rgba(33, 26, 17, 0.96));
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(232, 168, 68, 0.5);
  color: #f2ece1;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.glyph {
  flex: none;
  color: #e8a844;
}
.message {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
}
.label {
  margin-right: 8px;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #e8a844;
}
.more,
.close {
  flex: none;
  cursor: pointer;
  color: #cfc4b2;
  border-radius: var(--radius-btn);
  transition:
    background 160ms ease,
    color 160ms ease;
}
.more {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid rgba(232, 168, 68, 0.35);
}
.more:hover,
.close:hover {
  background: rgba(232, 168, 68, 0.16);
  color: #fff6e8;
}
.close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}
.tips {
  margin: 8px 0 2px 26px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12.5px;
  line-height: 1.45;
  color: #d8cebd;
}
.tips li {
  position: relative;
  padding-left: 14px;
}
.tips li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 7px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(232, 168, 68, 0.7);
}
/* Opacity only: the band's height is what the stage lays itself out against, so
   animating it would resize the canvas on every frame of the transition. */
.perf-enter-active,
.perf-leave-active {
  transition: opacity 200ms ease;
}
.perf-enter-from,
.perf-leave-to {
  opacity: 0;
}

@media (max-width: 560px) {
  .perf-notice {
    padding: 8px 10px;
  }
  .label {
    display: none;
  }
  .more {
    padding: 4px 8px;
  }
  .tips {
    margin-left: 0;
  }
}
</style>
