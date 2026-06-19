import { createI18n } from "vue-i18n";
import en from "./locales/en";
import fr from "./locales/fr";
import es from "./locales/es";
import de from "./locales/de";

export const SUPPORTED_LOCALES = ["en", "fr", "es", "de"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

// Endonyms: each language shown in its own name so a user recognizes it
// regardless of the active UI locale.
export const LOCALE_NAMES: Record<AppLocale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  de: "Deutsch",
};

// BCP 47 tags drive Intl number/date formatting per locale.
export const LOCALE_TAGS: Record<AppLocale, string> = {
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  de: "de-DE",
};

const STORAGE_KEY = "mpp.locale";

function isSupported(value: string | null | undefined): value is AppLocale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function detectLocale(): AppLocale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isSupported(stored)) return stored;
  } catch {
    // private mode or storage disabled: fall through to browser language
  }
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of candidates) {
    const base = tag?.toLowerCase().split("-")[0];
    if (isSupported(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: DEFAULT_LOCALE,
  messages: { en, fr, es, de },
});

export function activeLocale(): AppLocale {
  return i18n.global.locale.value as AppLocale;
}

export function setLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale;
  document.documentElement.setAttribute("lang", locale);
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // best effort: the in-memory locale still switches
  }
}
