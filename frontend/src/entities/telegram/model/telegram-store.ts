import { create } from "zustand";

import type {
  CurrentUserDto,
  TelegramAuthState,
  TelegramLoginConfigurationDto,
  TelegramLoginInput,
} from "../../../../../contracts/src/ipc";

interface TelegramState {
  auth: TelegramAuthState | null;
  configuration: TelegramLoginConfigurationDto | null;
  currentUser: CurrentUserDto | null;
  start(): () => void;
  loadCurrentUser(): Promise<void>;
  beginLogin(input: TelegramLoginInput): Promise<void>;
  submitChallenge(value: string): Promise<void>;
  logout(): Promise<void>;
}

export const useTelegramStore = create<TelegramState>((set) => ({
  auth: null,
  configuration: null,
  currentUser: null,
  start() {
    const unsubscribe = window.telo.telegram.onAuthState((auth) =>
      set({ auth }),
    );
    void Promise.all([
      window.telo.telegram.getAuthState(),
      window.telo.telegram.getLoginConfiguration(),
    ]).then(([auth, configuration]) => set({ auth, configuration }));
    return unsubscribe;
  },
  async loadCurrentUser() {
    const currentUser = await window.telo.workspace.getCurrentUser();
    set({ currentUser });
  },
  async beginLogin(input) {
    try {
      await window.telo.telegram.beginLogin(input);
    } catch (error) {
      set({ auth: { status: "error", message: safeMessage(error) } });
    }
  },
  async submitChallenge(value) {
    try {
      await window.telo.telegram.submitChallenge(value);
    } catch (error) {
      set({ auth: { status: "error", message: safeMessage(error) } });
    }
  },
  async logout() {
    try {
      await window.telo.telegram.logout();
      // The post-logout state is known — idle, not "not loaded yet" (null).
      // Onboarding's loading gate reads null as still-initializing, so a null
      // here would strand the welcome step on its connecting shimmer.
      set({ auth: { status: "idle" }, currentUser: null });
    } catch (error) {
      set({ auth: { status: "error", message: safeMessage(error) } });
    }
  },
}));

function safeMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Telegram authentication failed";
}
