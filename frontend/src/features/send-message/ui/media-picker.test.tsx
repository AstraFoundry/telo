import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StickerSetDto } from "../../../../../contracts/src/ipc";
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
  installed: true,
  stickers: [
    {
      id: "sticker/1",
      emoji: "👋",
      format: "static",
      width: 512,
      height: 512,
    },
    {
      id: "sticker/2",
      emoji: "🎉",
      format: "animated",
      width: 512,
      height: 512,
    },
  ],
};

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

  it("loads the sets when the sticker tab is first shown, not on open", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    telo.workspace.listStickerSets.mockResolvedValue([SET]);
    const onPickSticker = vi.fn();

    renderPicker({ onPickSticker });

    await user.click(screen.getByRole("button", { name: copy.mediaPicker }));

    // Emoji is the landing section, so opening the panel costs no round trip.
    expect(telo.workspace.listStickerSets).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: copy.stickerPicker }));

    const cell = await screen.findByRole("button", { name: "👋" });
    // Each cell pulls its own document through the shared media pipeline.
    await waitFor(() => {
      expect(telo.workspace.downloadMedia).toHaveBeenCalledWith("sticker/1");
    });

    await user.click(cell);

    expect(onPickSticker).toHaveBeenCalledWith(SET.stickers[0]);
  });

  it("keeps a section's loaded state when the user tabs away and back", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    telo.workspace.listStickerSets.mockResolvedValue([SET]);

    renderPicker();

    await user.click(screen.getByRole("button", { name: copy.mediaPicker }));
    await user.click(screen.getByRole("button", { name: copy.stickerPicker }));
    await screen.findByRole("button", { name: "👋" });

    await user.click(screen.getByRole("button", { name: copy.emojiPicker }));
    await user.click(screen.getByRole("button", { name: copy.stickerPicker }));

    expect(await screen.findByRole("button", { name: "👋" })).toBeTruthy();
    // Switching sections is not a reload: the sets were fetched once.
    expect(telo.workspace.listStickerSets).toHaveBeenCalledTimes(1);
  });

  it("says so when the account has no sets instead of showing an empty grid", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    telo.workspace.listStickerSets.mockResolvedValue([]);

    renderPicker();
    await user.click(screen.getByRole("button", { name: copy.mediaPicker }));
    await user.click(screen.getByRole("button", { name: copy.stickerPicker }));

    expect(await screen.findByText(copy.noStickerSets)).toBeTruthy();
  });
});
