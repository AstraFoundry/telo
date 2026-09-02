import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MessageMedia, visualMediaBox } from "shared/ui";

const media = {
  id: "chat/42",
  kind: "photo" as const,
  fileName: "photo.jpg",
  mimeType: "image/jpeg",
  size: 2048,
  width: 800,
  height: 600,
  duration: null,
  spoiler: false,
};
const labels = {
  download: "Download attachment",
  cancel: "Cancel download",
  retry: "Retry download",
  reveal: "Reveal hidden text",
  failed: "Attachment download failed",
  expand: "View media",
  sticker: "Sticker",
  playSticker: "Play sticker",
  openStickerSet: "Open sticker set",
};

describe("MessageMedia", () => {
  it("requests a download and exposes determinate byte progress", async () => {
    const onDownload = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <MessageMedia
        media={media}
        download={null}
        labels={labels}
        onDownload={onDownload}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: labels.download }),
    );
    expect(onDownload).toHaveBeenCalledOnce();
    rerender(
      <MessageMedia
        media={media}
        download={{
          state: "downloading",
          downloadedBytes: 1024,
          totalBytes: 2048,
          url: null,
          error: null,
        }}
        labels={labels}
        downloadIsExplicit
        onDownload={onDownload}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "1024",
    );
    await userEvent.click(screen.getByRole("button", { name: labels.cancel }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders a completed photo from the internal media URL", () => {
    render(
      <MessageMedia
        media={media}
        download={{
          state: "ready",
          downloadedBytes: 2048,
          totalBytes: 2048,
          url: "telo-media://cache/chat_42.jpg",
          error: null,
        }}
        labels={labels}
        onDownload={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "telo-media://cache/chat_42.jpg",
    );
  });

  it("opens the viewer from a ready photo and reports the clicked element", async () => {
    const onOpen = vi.fn();
    render(
      <MessageMedia
        media={media}
        download={{
          state: "ready",
          downloadedBytes: 2048,
          totalBytes: 2048,
          url: "telo-media://cache/chat_42.jpg",
          error: null,
        }}
        labels={labels}
        onDownload={vi.fn()}
        onCancel={vi.fn()}
        onOpen={onOpen}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "photo.jpg" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen.mock.calls[0][0]).toBeInstanceOf(HTMLElement);
  });

  it("keeps automatic preloads quiet and shows progress only when explicit", () => {
    const downloading = {
      state: "downloading" as const,
      downloadedBytes: 1024,
      totalBytes: 2048,
      url: null,
      error: null,
    };
    const { rerender } = render(
      <MessageMedia
        media={media}
        download={downloading}
        labels={labels}
        onDownload={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();

    rerender(
      <MessageMedia
        media={media}
        download={downloading}
        labels={labels}
        downloadIsExplicit
        onDownload={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "1024",
    );
  });

  it("offers a retry after a failed preload instead of a progress bar", () => {
    render(
      <MessageMedia
        media={media}
        download={{
          state: "failed",
          downloadedBytes: 0,
          totalBytes: 2048,
          url: null,
          error: "network dropped",
        }}
        labels={labels}
        onDownload={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: labels.retry })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(labels.failed);
  });

  it("renders an album tile as a cover crop that opens the viewer", async () => {
    const onOpen = vi.fn();
    render(
      <MessageMedia
        tile
        media={media}
        download={{
          state: "ready",
          downloadedBytes: 2048,
          totalBytes: 2048,
          url: "telo-media://cache/chat_42.jpg",
          error: null,
        }}
        labels={labels}
        onDownload={vi.fn()}
        onCancel={vi.fn()}
        onOpen={onOpen}
      />,
    );
    const tileButton = screen.getByRole("button", { name: "photo.jpg" });
    expect(tileButton.querySelector("img")?.className).toContain(
      "object-cover",
    );
    await userEvent.click(tileButton);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("reserves the same box before and after the photo lands", () => {
    const frame = (container: HTMLElement) =>
      container.querySelector<HTMLElement>('[style*="aspect-ratio"]');

    const { container, rerender } = render(
      <MessageMedia
        media={media}
        download={null}
        labels={labels}
        onDownload={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const placeholder = frame(container)?.getAttribute("style");

    rerender(
      <MessageMedia
        media={media}
        download={{
          state: "ready",
          downloadedBytes: 2048,
          totalBytes: 2048,
          url: "telo-media://chat/42",
          error: null,
        }}
        labels={labels}
        onDownload={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Identical geometry in both states is the whole point: the pixels drop
    // into a hole that was already the right shape, so nothing below the
    // photo moves and the reader's scroll position holds.
    expect(placeholder).toBeTruthy();
    expect(frame(container)?.getAttribute("style")).toBe(placeholder);
  });

  it("derives the photo box from the dimensions the message carries", () => {
    // 4:3 at the 384px height cap.
    expect(visualMediaBox(800, 600)).toEqual({
      aspectRatio: `${4 / 3}`,
      width: "min(100%, 512px)",
    });
    // A very tall photo is boxed at 1:2 rather than rendered as a sliver.
    expect(visualMediaBox(200, 1000)).toEqual({
      aspectRatio: "0.5",
      width: "min(100%, 192px)",
    });
    // Nothing to reserve without dimensions; the caller falls back to a
    // bounded placeholder and lets scroll anchoring absorb the difference.
    expect(visualMediaBox(null, null)).toBeNull();
    expect(visualMediaBox(800, 0)).toBeNull();
  });

  it("renders a webpage preview as a safe external link card", () => {
    render(
      <MessageMedia
        media={{
          id: "chat/9",
          kind: "webpage",
          url: "https://example.com/spacing-craft",
          displayUrl: "example.com/spacing-craft",
          siteName: "Example Journal",
          title: "Spacing is a system, not a vibe",
          description: "Why consistent rhythm beats one-off tweaks.",
          thumbnailMediaId: null,
        }}
        download={null}
        labels={labels}
        onDownload={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", {
      name: /Spacing is a system, not a vibe/,
    });
    expect(link.getAttribute("href")).toBe("https://example.com/spacing-craft");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(screen.queryByRole("button", { name: labels.download })).toBeNull();
  });

  it("degrades a url-only webpage to a bare link card", () => {
    render(
      <MessageMedia
        media={{
          id: "chat/10",
          kind: "webpage",
          url: "https://example.com",
          displayUrl: null,
          siteName: null,
          title: null,
          description: null,
          thumbnailMediaId: null,
        }}
        download={null}
        labels={labels}
        onDownload={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("link", { name: "https://example.com" }),
    ).toBeTruthy();
  });
});
