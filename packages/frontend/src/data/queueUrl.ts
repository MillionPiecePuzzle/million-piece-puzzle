// Admission queue endpoints, served from the WS host (the same Node process as
// the auth routes), so they share the auth base resolution. Anonymous and never
// cached; the client requests a ticket then polls status until admitted.
import { authBaseUrl } from "./authBaseUrl";

export function queueTicketUrl(): string {
  return `${authBaseUrl()}/queue/ticket`;
}

export function queueStatusUrl(ticket: string): string {
  return `${authBaseUrl()}/queue/status?ticket=${encodeURIComponent(ticket)}`;
}
