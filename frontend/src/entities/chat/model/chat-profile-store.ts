import { create } from "zustand";

interface ChatProfileState {
  /** Whether the chat profile panel occupies the workspace's right column. */
  open: boolean;
  openPanel(): void;
  closePanel(): void;
}

// Panel visibility lives next to the other chat UI state (in-chat search,
// jump targets) so the conversation header and the profile widget share one
// definition. The mutual exclusion with the agent panel is orchestrated by
// the chat-profile widget, which may import both entity stores.
export const useChatProfileStore = create<ChatProfileState>((set) => ({
  open: false,
  openPanel: () => set({ open: true }),
  closePanel: () => set({ open: false }),
}));
