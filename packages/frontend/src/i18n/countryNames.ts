import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { COUNTRIES, INTERNATIONAL } from "@mpp/shared";
import { LOCALE_TAGS, type AppLocale } from "./index";

// The shared country dataset carries English names only. The four UI locales
// read theirs from Intl.DisplayNames, which ships every region name the browser
// knows, so no translated country list is stored in the app and the dataset
// name is only ever a fallback.
const englishNames = new Map([...COUNTRIES, INTERNATIONAL].map((c) => [c.code, c.name]));

// One formatter per locale tag: the nationality picker resolves 251 names on
// every render, and constructing a DisplayNames per name is what makes that
// expensive.
const formatters = new Map<string, Intl.DisplayNames | null>();

function regionNames(tag: string): Intl.DisplayNames | null {
  if (!formatters.has(tag)) {
    try {
      // "none" is what makes the English fallback reachable: the default echoes
      // the code back, so an unknown region would read "ZZ" rather than its
      // dataset name.
      formatters.set(tag, new Intl.DisplayNames([tag], { type: "region", fallback: "none" }));
    } catch {
      formatters.set(tag, null);
    }
  }
  return formatters.get(tag) ?? null;
}

// The international opt-out is not a region: CLDR knows "UN" as the United
// Nations, which is not what the picker offers it as, so it takes the app's own
// translated label instead.
export function countryName(code: string, tag: string, internationalLabel: string): string {
  const lower = code.toLowerCase();
  if (lower === INTERNATIONAL.code) return internationalLabel;
  const fallback = englishNames.get(lower) ?? code.toUpperCase();
  try {
    return regionNames(tag)?.of(lower.toUpperCase()) ?? fallback;
  } catch {
    return fallback;
  }
}

// Localized country label from an ISO 3166-1 alpha-2 code, following the active
// UI locale. Shared by every place a flag or a country name is shown.
export function useCountryNames() {
  const { t, locale } = useI18n();
  const tag = computed(() => LOCALE_TAGS[locale.value as AppLocale]);

  function name(code: string): string {
    return countryName(code, tag.value, t("nationality.international"));
  }

  return { countryName: name, localeTag: tag };
}
