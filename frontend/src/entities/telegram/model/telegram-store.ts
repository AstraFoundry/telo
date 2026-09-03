import { create } from "zustand";

import type {
  CurrentUserDto,
  TelegramAccountDto,
  TelegramAuthState,
  TelegramLoginConfigurationDto,
  TelegramLoginInput,
} from "../../../../../contracts/src/ipc";

interface TelegramState {
  auth: TelegramAuthState | null;
  configuration: TelegramLoginConfigurationDto | null;
  currentUser: CurrentUserDto | null;
  accounts: ReadonlyArray<TelegramAccountDto>;
  /**
   * Routes a signed-in user through onboarding again to register another
   * account. Only meaningful while `auth` is `ready`; the completed login is
   * what registers the new account main-side.
   */
  addingAccount: boolean;
  start(): () => void;
  loadCurrentUser(): Promise<void>;
  loadAccounts(): Promise<void>;
  switchAccount(accountId: string): Promise<void>;
  startAddingAccount(): void;
  cancelAddingAccount(): void;
  beginLogin(input: TelegramLoginInput): Promise<void>;
  submitChallenge(value: string): Promise<void>;
  logout(): Promise<void>;
}

export const useTelegramStore = create<TelegramState>((set) => ({
  auth: null,
  configuration: null,
  accounts: [],
  addingAccount: false,
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
    // Unlike the other startup loaders, this hits a live Telegram RPC
    // (`getMe()`), so a transient network failure must not leave an
    // unhandled rejection or a permanently empty account row: the caller
    // retries this on the next reconnect (see `App`'s connection-state
    // effect), so failing here just means "not yet" rather than "never".
    try {
      const currentUser = await window.telo.workspace.getCurrentUser();
      set({ currentUser });
    } catch (error) {
      console.error("Failed to load the current Telegram user", error);
    }
  },
  async loadAccounts() {
    // The account registry read is local to the main process, but it can
    // still fail while a switch is mid-flight; the caller re-reads on every
    // transition to `ready`, so a failure here means "not yet", not "never".
    try {
      const accounts = await window.telo.telegram.listAccounts();
      set({ accounts });
    } catch (error) {
      console.error("Failed to load the Telegram accounts", error);
    }
  },
  async switchAccount(accountId) {
    // The auth-state flow does the rest: the main process emits restoring →
    // ready for the target account, and `App` reloads the workspace on that
    // transition. Nothing to await or reload here.
    try {
      await window.telo.telegram.setActiveAccount(accountId);
    } catch (error) {
      set({ auth: { status: "error", message: safeMessage(error) } });
    }
  },
  startAddingAccount() {
    set({ addingAccount: true });
  },
  cancelAddingAccount() {
    set({ addingAccount: false });
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
