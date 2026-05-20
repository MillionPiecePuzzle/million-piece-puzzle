/**
 * Anonymous session identity.
 *
 * Phase 0 only: the server assigns an ephemeral id on WS connect. Lives in
 * connection state, never persisted. Distinct from the Mongo User type which
 * represents an authenticated, named contributor.
 */

export type AnonymousUser = {
  id: string;
  pseudo: string | null;
};

export const PSEUDO_MIN_LENGTH = 2;
export const PSEUDO_MAX_LENGTH = 16;

// Letters, digits, spaces, hyphens and underscores. Letters and digits use the
// Unicode classes so accented names are accepted.
const PSEUDO_PATTERN = /^[\p{L}\p{N} _-]+$/u;

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
