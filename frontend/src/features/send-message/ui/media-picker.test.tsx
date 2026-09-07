import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  StickerCatalogDto,
  StickerSetDto,
} from "../../../../../contracts/src/ipc";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

import { MediaPicker } from "./media-picker";

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

const SET: StickerSetDto = {
  id: "1",
  title: "Telo Pack",
  shortName: "TeloPack",
  reference: { kind: "short-name", shortName: "TeloPack" },
  installed: true,
  stickers: [
    {
      id: "sticker/1",
      emoji: "👋",
      format: "static",
      width: 512,
      height: 512,
      outlinePath: null,
    },
    {
      id: "sticker/2",
      emoji: "🎉",
      format: "animated",
      width: 512,
      height: 512,
      outlinePath: null,
    },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function renderPicker(overrides?: {
  onPickEmoji?: (glyph: string) => void;
  onPickSticker?: (sticker: StickerSetDto["stickers"][number]) => void;
}) {
  return render(
    <MediaPicker
      disabled={false}
      recentEmojis={[]}
      onPickEmoji={overrides?.onPickEmoji ?? vi.fn()}
      onPickSticker={overrides?.onPickSticker ?? vi.fn()}
    />,
  );
}

describe("MediaPicker", () => {
  beforeEach(() => {
    stubMatchMedia();
    // jsdom has no ResizeObserver, which the beui popover positioning uses.
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });

  beforeEach(async () => {
    // The sticker sets moved from component state into the chat store, which
    // is a singleton: a settled load must not leak into the next test. The
    // dynamic import shares the graph reset no test here resets, so the same
    // module instance is just mutated back.
    const { useChatStore } = await import("../../../entities/chat");
    useChatStore.setState({
      stickerSets: null,
      recentStickers: [],
      favoriteStickers: [],
      stickerSetsError: null,
    });
  });

  it("puts emoji and stickers behind one composer button", async () => {
    const user = userEvent.setup();
    installTeloApiMock();

    renderPicker();

    // The composer owes a single expressive affordance, not one button per
    // media kind.
    expect(screen.queryByRole("button", { name: copy.emojiPicker })).toBeNull();
    expect(
      screen.queryByRole("button", { name: copy.stickerPicker }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: copy.mediaPicker }));

    expect(screen.getByRole("button", { name: copy.emojiPicker })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: copy.stickerPicker }),
    ).toBeTruthy();
  });

  it("disables the stickers tab when stickers cannot be sent", async () => {
    const user = userEvent.setup();
    const onPickSticker = vi.fn();
    installTeloApiMock();

    render(
      <MediaPicker
        disabled={false}
        stickersDisabled
        recentEmojis={[]}
        onPickEmoji={vi.fn()}
        onPickSticker={onPickSticker}
      />,
    );

    await user.click(screen.getByRole("button", { name: copy.mediaPicker }));
    const stickersTab = screen.getByRole("button", {
      name: copy.stickersDisabled,
    });
    expect(stickersTab).toHaveProperty("disabled", true);
    await user.click(stickersTab);
    expect(onPickSticker).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: copy.stickerPicker }),
    ).toBeNull();
  });

  it("loads the sets when the sticker tab is first shown, not on open", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    telo.workspace.getStickerCatalog.mockResolvedValue({
      recent: [],
      favorites: [],
      sets: [SET],
    });
    telo.workspace.getStickerSet.mockResolvedValue(SET);
    const onPickSticker = vi.fn();

    renderPicker({ onPickSticker });

    await user.click(screen.getByRole("button", { name: copy.mediaPicker }));

    // Emoji is the landing section, so opening the panel costs no round trip.
    expect(telo.workspace.getStickerCatalog).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: copy.stickerPicker }));

    const cell = await screen.findByRole("button", { name: "👋" });
    expect(telo.workspace.getStickerSet).toHaveBeenCalledWith(SET.reference);
    const packTab = screen.getByRole("button", { name: SET.title });
    expect(packTab.textContent).not.toContain("👋");
    expect(packTab.querySelector('[data-slot="sticker"]')).toBeTruthy();
    // Each cell pulls its own document through the shared media pipeline.
    await waitFor(() => {
      expect(telo.workspace.downloadMedia).toHaveBeenCalledWith("sticker/1");
    });

    await user.click(cell);

    expect(onPickSticker).toHaveBeenCalledWith(SET.stickers[0]);
  });

  it("reserves the complete sticker panel while the catalog loads", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    const catalog = deferred<StickerCatalogDto>();
    telo.workspace.getStickerCatalog.mockReturnValue(catalog.promise);

    renderPicker();

    await user.click(screen.getByRole("button", { name: copy.mediaPicker }));
    await user.click(screen.getByRole("button", { name: copy.stickerPicker }));

    const skeleton = screen.getByRole("status", {
      name: copy.loadingStickerSet,
    });
    expect(screen.queryByText(copy.loading)).toBeNull();
    expect(
      skeleton.querySelectorAll('[data-slot="sticker-grid-skeleton"]'),
    ).toHaveLength(12);
    expect(
      skeleton.querySelectorAll(
        '[data-slot="sticker-pack-thumbnail-skeleton"]',
      ),
    ).toHaveLength(5);

    catalog.resolve({ recent: [], favorites: [], sets: [] });
    expect(await screen.findByText(copy.noStickerSets)).toBeTruthy();
  });

  it("uses geometry-matched skeletons while a sticker pack resolves", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    telo.workspace.getStickerCatalog.mockResolvedValue({
      recent: [],
      favorites: [],
      sets: [SET],
    });
    const stickerSet = deferred<StickerSetDto>();
    telo.workspace.getStickerSet.mockReturnValue(stickerSet.promise);

    renderPicker();

    await user.click(screen.getByRole("button", { name: copy.mediaPicker }));
    await user.click(screen.getByRole("button", { name: copy.stickerPicker }));

    const packTab = await screen.findByRole("button", { name: SET.title });
    const skeleton = screen.getByRole("status", {
      name: copy.loadingStickerSet,
    });
    expect(screen.queryByText(copy.loading)).toBeNull();
    expect(
      skeleton.querySelectorAll('[data-slot="sticker-grid-skeleton"]'),
    ).toHaveLength(12);
    expect(
      packTab.querySelector('[data-slot="sticker-pack-thumbnail-skeleton"]'),
    ).toBeTruthy();

    stickerSet.resolve(SET);
    expect(await screen.findByRole("button", { name: "👋" })).toBeTruthy();
  });

  it("keeps a section's loaded state when the user tabs away and back", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    telo.workspace.getStickerCatalog.mockResolvedValue({
      recent: [],
      favorites: [],
      sets: [SET],
    });
    telo.workspace.getStickerSet.mockResolvedValue(SET);

    renderPicker();

    await user.click(screen.getByRole("button", { name: copy.mediaPicker }));
    await user.click(screen.getByRole("button", { name: copy.stickerPicker }));
    await screen.findByRole("button", { name: "👋" });

    await user.click(screen.getByRole("button", { name: copy.emojiPicker }));
    await user.click(screen.getByRole("button", { name: copy.stickerPicker }));

    expect(await screen.findByRole("button", { name: "👋" })).toBeTruthy();
    // Switching sections is not a reload: the sets were fetched once.
    expect(telo.workspace.getStickerCatalog).toHaveBeenCalledTimes(1);
  });

  it("says so when the account has no sets instead of showing an empty grid", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    telo.workspace.getStickerCatalog.mockResolvedValue({
      recent: [],
      favorites: [],
      sets: [],
    });

    renderPicker();
    await user.click(screen.getByRole("button", { name: copy.mediaPicker }));
    await user.click(screen.getByRole("button", { name: copy.stickerPicker }));

    expect(await screen.findByText(copy.noStickerSets)).toBeTruthy();
  });

  it("opens a sticker preview from its secondary-action menu", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    telo.workspace.getStickerCatalog.mockResolvedValue({
      recent: [SET.stickers[0]!],
      favorites: [],
      sets: [SET],
    });
    const onPickSticker = vi.fn();
    renderPicker({ onPickSticker });

    await user.click(screen.getByRole("button", { name: copy.mediaPicker }));
    await user.click(screen.getByRole("button", { name: copy.stickerPicker }));
    const sticker = await screen.findByRole("button", { name: "👋" });
    fireEvent.contextMenu(sticker);
    await user.click(
      await screen.findByRole("menuitem", { name: copy.previewSticker }),
    );

    const preview = await screen.findByRole("dialog", {
      name: copy.previewSticker,
    });
    expect(preview).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: copy.addFavoriteSticker }),
    );
    await waitFor(() => {
      expect(telo.workspace.setStickerFavorite).toHaveBeenCalledWith(
        "sticker/1",
        true,
      );
    });
    await user.click(screen.getByRole("button", { name: copy.sendSticker }));
    expect(onPickSticker).toHaveBeenCalledWith(SET.stickers[0]);
  });

  it("reorders installed packs and persists their complete id order", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    const second: StickerSetDto = {
      ...SET,
      id: "2",
      title: "Second Pack",
      shortName: "SecondPack",
      stickers: [{ ...SET.stickers[0]!, id: "sticker/3", emoji: "🐙" }],
    };
    telo.workspace.getStickerCatalog.mockResolvedValue({
      recent: [],
      favorites: [],
      sets: [SET, second],
    });
    renderPicker();

    await user.click(screen.getByRole("button", { name: copy.mediaPicker }));
    await user.click(screen.getByRole("button", { name: copy.stickerPicker }));
    await user.click(
      await screen.findByRole("button", { name: copy.manageStickerSets }),
    );
    await user.click(
      screen.getByRole("button", {
        name: `${copy.moveStickerSetDown}: ${SET.title}`,
      }),
    );

    await waitFor(() => {
      expect(telo.workspace.reorderStickerSets).toHaveBeenCalledWith([
        "2",
        "1",
      ]);
    });
  });

  it("searches Telegram stickers and keeps result actions available", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    const result = { ...SET.stickers[1]!, id: "sticker/remote" };
    telo.workspace.getStickerCatalog.mockResolvedValue({
      recent: [],
      favorites: [],
      sets: [SET],
    });
    telo.workspace.searchStickers.mockResolvedValue([result]);
    renderPicker();

    await user.click(screen.getByRole("button", { name: copy.mediaPicker }));
    await user.click(screen.getByRole("button", { name: copy.stickerPicker }));
    await user.type(
      await screen.findByRole("textbox", { name: copy.searchStickers }),
      "party",
    );

    await waitFor(() => {
      expect(telo.workspace.searchStickers).toHaveBeenCalledWith("party");
    });
    const sticker = await screen.findByRole("button", { name: "🎉" });
    fireEvent.contextMenu(sticker);
    expect(
      await screen.findByRole("menuitem", { name: copy.previewSticker }),
    ).toBeTruthy();
  });
});
