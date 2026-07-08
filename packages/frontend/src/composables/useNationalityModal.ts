import { useModal } from "./useModal";

// "forced": a signed-in user choosing a missing country, cannot be dismissed
// until one is chosen. "guest": the second (minting) step of in-site guest
// onboarding, also non-dismissible. "edit": opened from the topbar to change an
// existing nationality, dismissible.
export type NationalityModalMode = "forced" | "edit" | "guest";

const modal = useModal<NationalityModalMode>("edit");

export function useNationalityModal() {
  return modal;
}
