import { describe, it, expect } from "vitest";
import en from "./locales/en";
import fr from "./locales/fr";
import es from "./locales/es";
import de from "./locales/de";

// Translations are written by hand and pasted through tools that do not always
// agree on encoding, and a mangled accent reads as a typo in a language nobody
// on the team proofreads. Both signatures below are impossible in text anyone
// typed on purpose, so they only ever mean the bytes were mishandled: UTF-8
// decoded as latin-1 and re-encoded (a latin-1 lead followed by a
// continuation-range character, plus the smart-quote family's own lead), and a
// byte no decoder could read at all. Written as escapes so this file cannot
// fall to what it guards against.
const DOUBLE_ENCODED = /[\u00c2\u00c3][\u0080-\u00bf]|\u00e2\u20ac/;
const UNDECODABLE = /\ufffd/;

type Messages = { [key: string]: string | Messages };

const LOCALES: Record<string, Messages> = { en, fr, es, de };

function messageEntries(messages: Messages, prefix = ""): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "string"
      ? [[`${prefix}${key}`, value] as [string, string]]
      : messageEntries(value, `${prefix}${key}.`),
  );
}

function offenders(pattern: RegExp): string[] {
  const out: string[] = [];
  for (const [locale, messages] of Object.entries(LOCALES)) {
    for (const [key, text] of messageEntries(messages)) {
      if (pattern.test(text)) out.push(`${locale}.${key}: ${text}`);
    }
  }
  return out;
}

describe("locale messages", () => {
  it("walks every locale down to its leaf strings", () => {
    for (const [locale, messages] of Object.entries(LOCALES)) {
      expect(messageEntries(messages).length, locale).toBeGreaterThan(50);
    }
  });

  it("carries no double-encoded UTF-8", () => {
    expect(offenders(DOUBLE_ENCODED)).toEqual([]);
  });

  it("carries no character that failed to decode", () => {
    expect(offenders(UNDECODABLE)).toEqual([]);
  });
});
