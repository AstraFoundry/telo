import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserPreferencesDto } from "../../../contracts/src/ipc";
import { installTeloApiMock } from "../shared/test/mock-telo";

// jsdom does not implement matchMedia, which the theme model applies at module
// scope when the preferences slice is imported.
function stubMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// The preference stores and the chat store are module-level singletons that
// load once, so each case needs them rebuilt after `vi.resetModules()` — a
// static import would hand every case the first one's resolved state.
async function mountSync() {
  const [{ useChatPreferenceSync }, { useChatStore }] = await Promise.all([
    import("./chat-preference-sync"),
    import("../entities/chat"),
  ]);
  renderHook(() => useChatPreferenceSync());
  return useChatStore;
}

describe("useChatPreferenceSync", () => {
  beforeEach(() => {
    vi.resetModules();
    stubMatchMedia();
  });

  it("carries the persisted preferences into the chat store", async () => {
    const telo = installTeloApiMock();
    const stored = await telo.preferences.get();
    telo.preferences.get.mockResolvedValue({
      ...stored,
      notificationsEnabled: true,
      notificationSenderName: false,
      notificationPreview: false,
      countMutedChats: true,
    });

    const useChatStore = await mountSync();

    // Every one of the four differs from the store's boot state, so nothing
    // here can pass on a default.
    await waitFor(() => {
      expect(useChatStore.getState()).toMatchObject({
        notificationsEnabled: true,
        notificationSenderName: false,
        notificationPreview: false,
        countMutedChats: true,
      });
    });
  });

  it("recomputes the keyword badges when the muted-chat rule changes", async () => {
    const telo = installTeloApiMock();
    const stored = await telo.preferences.get();
    telo.preferences.get.mockResolvedValue({
      ...stored,
      countMutedChats: true,
    });
    const { useChatStore } = await import("../entities/chat");
    useChatStore.setState({
      chats: [
        {
          id: "silenced",
          title: "Chat silenced",
          preview: "",
          updatedAt: "2026-01-01T00:00:00.000Z",
          unreadCount: 6,
          lastReadMessageId: null,
          muted: true,
          pinned: false,
          kind: "direct",
          initials: "C",
          avatarDataUrl: null,
          draftPreview: null,
          typing: false,
          keywordFolderIds: [-1],
        },
      ],
      folders: [
        {
          id: -1,
          title: "Spacing",
          unreadCount: 0,
          kind: "keyword",
          query: "spacing",
        },
      ],
    });

    await mountSync();

    await waitFor(() => {
      expect(useChatStore.getState().folders[0]?.unreadCount).toBe(6);
    });
  });

  it("leaves the conservative boot state alone until the preferences hydrate", async () => {
    const telo = installTeloApiMock();
    const stored = await telo.preferences.get();
    let release: (preferences: UserPreferencesDto) => void = () => {};
    const pending = new Promise<UserPreferencesDto>((resolve) => {
      release = resolve;
    });
    telo.preferences.get.mockReturnValue(pending);

    const useChatStore = await mountSync();
    await act(async () => {});

    // The hook answers with its own default — notifications on — while the
    // read is in flight. The store's boot value says off, and it wins.
    expect(useChatStore.getState().notificationsEnabled).toBe(false);

    await act(async () => {
      release({ ...stored, notificationsEnabled: true });
      await pending;
    });

    expect(useChatStore.getState().notificationsEnabled).toBe(true);
  });
});
