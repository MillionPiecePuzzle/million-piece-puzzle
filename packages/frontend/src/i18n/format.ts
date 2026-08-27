import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { LOCALE_TAGS, type AppLocale } from "./index";

// A progress readout must never claim the board is done before the last piece,
// so a ratio is floored rather than rounded: 999 999 of 1 000 000 rounds to
// 100% but floors to 99.999%. The floor runs in integer space because flooring
// the float percentage lands one step low on 12 218 of that board's counts (70
// locked reads 0.006% where the exact floor is 0.007%).
export function flooredPercent(part: number, whole: number, fractionDigits: number): number {
  if (whole <= 0) return 0;
  const steps = 100 * 10 ** fractionDigits;
  return Math.min(steps, Math.floor((part * steps) / whole)) / 10 ** fractionDigits;
}

// Locale-aware number and date formatting, following the active UI locale so
// grouping separators and month names match the chosen language.
export function useLocaleFormat() {
  const { locale } = useI18n();
  const tag = computed(() => LOCALE_TAGS[locale.value as AppLocale]);
  const numberFormat = computed(() => new Intl.NumberFormat(tag.value));

  function formatNumber(value: number): string {
    return numberFormat.value.format(value);
  }

  // The percent sign comes from Intl, not from the message, because the locales
  // disagree on it: fr, es and de put a no-break space before the sign, en does
  // not.
  function formatPercent(value: number, fractionDigits: number): string {
    return new Intl.NumberFormat(tag.value, {
      style: "percent",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value / 100);
  }

  function formatDate(ms: number): string {
    return new Date(ms).toLocaleDateString(tag.value, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  return { formatNumber, formatPercent, formatDate };
}
