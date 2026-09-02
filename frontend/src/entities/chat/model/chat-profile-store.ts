import { create } from "zustand";

interface ChatProfileState {
  /** Whether the chat profile panel occupies the workspace's right column. */
  open: boolean;
  /**
   * Peer whose profile is shown. Null follows the active chat, which is what
   * the header toggle wants. A message author sets it so tapping an avatar
   * opens that author instead of the conversation, the way Telegram opens a
   * profile from a group message.
   */
  peerId: string | null;
  openPanel(): void;
  openForPeer(peerId: string): void;
  closePanel(): void;
}

// Panel visibility lives next to the other chat UI state (in-chat search,
// jump targets) so the conversation header and the profile widget share one
// definition. The mutual exclusion with the agent panel is orchestrated by
// the chat-profile widget, which may import both entity stores.
export const useChatProfileStore = create<ChatProfileState>((set) => ({
  open: false,
  peerId: null,
  openPanel: () => set({ open: true, peerId: null }),
  openForPeer: (peerId) => set({ open: true, peerId }),
  closePanel: () => set({ open: false, peerId: null }),
}));
