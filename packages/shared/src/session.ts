/**
 * Pseudo validation, shared by the client and the server so the rule never
 * drifts. The pseudo is the contributor's public identity, stored on the Mongo
 * user profile and shown for snap attribution.
 */

export const PSEUDO_MIN_LENGTH = 2;
export const PSEUDO_MAX_LENGTH = 16;

// Minimum time between two pseudo or country changes. Does not gate the initial
// onboarding choice (a guest's minted pseudo/country, or a Google account's first
// forced pick), only a change to an already-set value.
export const PROFILE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Letters, digits, spaces, hyphens, underscores and hash marks. Letters and
// digits use the Unicode classes so accented names are accepted. The hash mark
// is only needed for the auto-generated "Guest #XXXX" onboarding-skip default
// (see generateGuestPseudo) but is accepted from manual input too, one shared
// rule for both sources.
const PSEUDO_PATTERN = /^[\p{L}\p{N} _#-]+$/u;

/**
 * Normalize a raw pseudo: trim, collapse inner whitespace runs to one space.
 * Returns the cleaned pseudo when it satisfies the length and charset rules,
 * or null when it is invalid. Shared so the client and server agree on the
 * rule with no drift.
 */
export function normalizePseudo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (cleaned.length < PSEUDO_MIN_LENGTH || cleaned.length > PSEUDO_MAX_LENGTH) return null;
  if (!PSEUDO_PATTERN.test(cleaned)) return null;
  return cleaned;
}

const GUEST_TAG_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const GUEST_TAG_LENGTH = 4;

/**
 * Generate a default pseudo for a player skipping the pseudo onboarding step:
 * "Guest #XXXX" with a random 4-character alphanumeric tag. Always satisfies
 * normalizePseudo, so it submits through the same path as a typed pseudo; a
 * collision on mint surfaces through the ordinary taken-pseudo retry.
 */
export function generateGuestPseudo(): string {
  let tag = "";
  for (let i = 0; i < GUEST_TAG_LENGTH; i++) {
    tag += GUEST_TAG_CHARS[Math.floor(Math.random() * GUEST_TAG_CHARS.length)];
  }
  return `Guest #${tag}`;
}
