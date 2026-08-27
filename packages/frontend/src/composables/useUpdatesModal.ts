import { useModal } from "./useModal";
import { useUpdatesSeen } from "./useUpdatesSeen";

const modal = useModal();

// Opening the notes is what clears the new mark, not opening the menu that
// links to them: a stray click on the gear must not bury a release unread.
export function useUpdatesModal() {
  const { markSeen } = useUpdatesSeen();
  return {
    ...modal,
    show: () => {
      markSeen();
      modal.show();
    },
  };
}
