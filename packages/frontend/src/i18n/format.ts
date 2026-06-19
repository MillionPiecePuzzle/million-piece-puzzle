import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { LOCALE_TAGS, type AppLocale } from "./index";

// Locale-aware number and date formatting, following the active UI locale so
// grouping separators and month names match the chosen language.
export function useLocaleFormat() {
  const { locale } = useI18n();
  const tag = computed(() => LOCALE_TAGS[locale.value as AppLocale]);
  const numberFormat = computed(() => new Intl.NumberFormat(tag.value));

  function formatNumber(value: number): string {
    return numberFormat.value.format(value);
  }

  function formatDate(ms: number): string {
    return new Date(ms).toLocaleDateString(tag.value, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  return { formatNumber, formatDate };
}
