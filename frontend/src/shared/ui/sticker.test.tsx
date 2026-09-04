import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageStickerDto } from "../../../../contracts/src/ipc";
import { copy } from "../config/copy";

import type { StickerProps } from "./sticker";

// Motion latches the reduced-motion query the first time a component asks for
// it, so the stub has to be in place before the module graph loads.
function stubMatchMedia(reducedMotion: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion") && reducedMotion,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function sticker(partial: Partial<MessageStickerDto> = {}): MessageStickerDto {
  return {
    emoji: "🐱",
    format: "static",
    setReference: { kind: "short-name", shortName: "CatPack" },
    outlinePath: null,
    ...partial,
  };
}

async function renderSticker(
  props: Partial<StickerProps> = {},
  reducedMotion = false,
) {
  vi.resetModules();
  stubMatchMedia(reducedMotion);
  const { Sticker } = await import("./sticker");
  return render(
    <Sticker
      sticker={sticker()}
      width={512}
      height={512}
      src="telo-media://cache/chat_1.png"
      label={copy.sticker}
      playLabel={copy.playSticker}
      {...props}
    />,
  );
}

describe("Sticker", () => {
  beforeEach(() => {
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws the sticker's own outline in its box until the document lands", async () => {
    const { container } = await renderSticker({
      src: null,
      sticker: sticker({ outlinePath: "M64,64L448,64L448,448L64,448z" }),
    });

    const outline = screen.getByRole("img", { name: "🐱" });
    expect(outline.tagName.toLowerCase()).toBe("svg");
    // The path is authored in the document's pixel space, so the viewBox has
    // to be the document's size or the silhouette lands off-centre.
    expect(outline.getAttribute("viewBox")).toBe("0 0 512 512");
    expect(outline.querySelector("path")?.getAttribute("d")).toBe(
      "M64,64L448,64L448,448L64,448z",
    );
    // The alt emoji is a different picture in the right box; it never stands
    // in for the sticker.
    expect(outline.textContent).toBe("");
    expect(container.querySelector("img")).toBeNull();
    // The box is reserved up front so the row does not jump when the
    // document arrives.
    const box = container.querySelector<HTMLElement>('[data-slot="sticker"]');
    expect(box?.style.width).toBe("180px");
    expect(box?.style.height).toBe("180px");
  });

  it("falls back to a skeleton when Telegram sent no vector thumbnail", async () => {
    const { container } = await renderSticker({ src: null });

    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    // Same reserved box either way.
    const box = container.querySelector<HTMLElement>('[data-slot="sticker"]');
    expect(box?.style.width).toBe("180px");
  });

  it("scales a non-square sticker down to the longest side", async () => {
    const { container } = await renderSticker({ width: 512, height: 256 });

    const box = container.querySelector<HTMLElement>('[data-slot="sticker"]');
    expect(box?.style.width).toBe("180px");
    expect(box?.style.height).toBe("90px");
  });

  it("draws a still sticker as an image named by its emoji", async () => {
    const { container } = await renderSticker();

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("telo-media://cache/chat_1.png");
    expect(image?.getAttribute("alt")).toBe("🐱");
    // A sticker is a transparent cutout, so it never takes the photo outline.
    expect(image?.className).not.toContain("outline");
  });

  it("falls back to the generic name when the set carries no emoji", async () => {
    const { container } = await renderSticker({
      sticker: sticker({ emoji: null }),
    });

    expect(container.querySelector("img")?.getAttribute("alt")).toBe(
      copy.sticker,
    );
  });

  it("loops a video sticker on its own, the way Telegram plays them", async () => {
    const { container } = await renderSticker({
      sticker: sticker({ format: "video" }),
    });

    const video = container.querySelector("video");
    expect(video?.hasAttribute("autoplay")).toBe(true);
    expect(video?.hasAttribute("loop")).toBe(true);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("gives a video sticker one pass and a replay control when looping is off", async () => {
    const { container } = await renderSticker({
      sticker: sticker({ format: "video" }),
      loop: false,
    });

    const video = container.querySelector("video");
    // The sticker is still the content, so it plays — once.
    expect(video?.hasAttribute("autoplay")).toBe(true);
    expect(video?.hasAttribute("loop")).toBe(false);
    expect(screen.queryByRole("button")).toBeNull();

    fireEvent.ended(video!);

    // Held on its last frame, with the same control reduced motion offers.
    expect(screen.getByRole("button", { name: copy.playSticker })).toBeTruthy();
  });

  // Reduced motion is covered in tests/e2e/reduced-motion.spec.ts: Motion
  // latches the media query the first time any component reads it, so jsdom
  // cannot flip it per test, while Playwright emulates it for real.
});
