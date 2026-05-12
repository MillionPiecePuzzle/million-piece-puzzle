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
