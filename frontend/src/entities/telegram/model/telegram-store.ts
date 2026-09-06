import { create } from "zustand";

import type {
  CurrentUserDto,
  TelegramAccountDto,
  TelegramAuthState,
  TelegramLoginConfigurationDto,
  TelegramLoginInput,
} from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import { isTechnicalErrorMessage } from "shared/lib/user-facing-error";

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

export const useTelegramStore = create<TelegramState>((set, get) => ({
  auth: null,
  configuration: null,
  accounts: [],
  addingAccount: false,
  currentUser: null,
  start() {
    const unsubscribeAuth = window.telo.telegram.onAuthState((auth) =>
      set({ auth: sanitizeAuth(auth) }),
    );
    const unsubscribeAvatars = window.telo.workspace.onEvent((event) => {
      if (event.type !== "chat-avatar") return;
      const currentUser = get().currentUser;
      if (!currentUser || currentUser.id !== event.chatId) return;
      set({
        currentUser: {
          ...currentUser,
          avatarDataUrl: event.avatarDataUrl,
          avatarPending: false,
        },
      });
    });
    void Promise.all([
      window.telo.telegram.getAuthState(),
      window.telo.telegram.getLoginConfiguration(),
    ]).then(([auth, configuration]) =>
      set({ auth: sanitizeAuth(auth), configuration }),
    );
    return () => {
      unsubscribeAuth();
      unsubscribeAvatars();
    };
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

function sanitizeAuth(auth: TelegramAuthState): TelegramAuthState {
  if (auth.status !== "error") return auth;
  return { status: "error", message: safeMessage(new Error(auth.message)) };
}

function safeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message.trim() : "";
  const mapped = mapTelegramAuthError(raw);
  if (mapped) return mapped;
  if (!raw || isTechnicalErrorMessage(raw)) return copy.loginFailed;
  return raw;
}

function mapTelegramAuthError(message: string): string | null {
  if (/\bPHONE_NUMBER_INVALID\b/.test(message)) return copy.loginPhoneInvalid;
  if (/\bPHONE_NUMBER_BANNED\b/.test(message)) return copy.loginPhoneInvalid;
  if (
    /\bPHONE_CODE_INVALID\b/.test(message) ||
    /\bPHONE_CODE_EMPTY\b/.test(message)
  ) {
    return copy.loginCodeInvalid;
  }
  if (/\bPHONE_CODE_EXPIRED\b/.test(message)) return copy.loginCodeExpired;
  if (/\bPASSWORD_HASH_INVALID\b/.test(message))
    return copy.loginPasswordInvalid;
  if (
    /\bFLOOD_WAIT\b/.test(message) ||
    /\bPHONE_NUMBER_FLOOD\b/.test(message)
  ) {
    return copy.loginFlood;
  }
  return null;
}
