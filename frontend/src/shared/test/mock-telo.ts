import { vi, type Mock } from "vitest";

import type { TeloDesktopApi } from "../../../../contracts/src/ipc";

type MockedFunctions<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown
    ? Mock<T[K]>
    : MockedFunctions<T[K]>;
};

export type TeloApiMock = MockedFunctions<TeloDesktopApi>;

/**
 * Installs a vi.fn()-backed `window.telo` preload contract mock and returns it
 * so tests can stub resolved/rejected values per case.
 */
export function installTeloApiMock(): TeloApiMock {
  const api: TeloApiMock = {
    workspace: {
      getCurrentUser: vi.fn(),
      listChatPage: vi.fn(async () => ({ items: [], nextCursor: null })),
      listMessagePage: vi.fn(async () => ({ items: [], nextCursor: null })),
      sendMessage: vi.fn(),
      editMessage: vi.fn(),
      deleteMessage: vi.fn(),
      forwardMessage: vi.fn(),
      setChatPinned: vi.fn(),
      setChatMuted: vi.fn(),
      setChatRead: vi.fn(),
      onEvent: vi.fn(() => () => {}),
    },
    agent: {
      getConfiguration: vi.fn(),
      saveConfiguration: vi.fn(),
      run: vi.fn(),
      onEvent: vi.fn(() => () => {}),
      listThreads: vi.fn(),
      getThread: vi.fn(),
      createThread: vi.fn(),
      selectThread: vi.fn(),
    },
    telegram: {
      getLoginConfiguration: vi.fn(),
      beginLogin: vi.fn(),
      submitChallenge: vi.fn(),
      getAuthState: vi.fn(),
      logout: vi.fn(),
      onAuthState: vi.fn(() => () => {}),
    },
    shell: {
      notify: vi.fn(),
    },
    preferences: {
      get: vi.fn(async () => ({
        agentPanelOpen: false,
        demoWorkspace: false,
        theme: "system",
        accentColor: "blue",
        messageTextSize: 14,
        timeFormat: "system",
        sendWithEnter: true,
        notificationsEnabled: true,
      })),
      update: vi.fn(),
    },
  };
  window.telo = api;
  return api;
}
