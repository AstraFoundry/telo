import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MediaViewer, type MediaViewerItem } from "shared/ui";

const labels = {
  viewer: "Media viewer",
  close: "Close viewer",
  previous: "Previous media",
  next: "Next media",
  saveAs: "Save as…",
  open: "Open",
  loading: "Loading",
};

const items: ReadonlyArray<MediaViewerItem> = [
  {
    id: "chat/1",
    kind: "photo",
    url: "telo-media://cache/chat_1.png",
    fileName: "one.png",
    caption: "First photo",
  },
  {
    id: "chat/2",
    kind: "photo",
    url: "telo-media://cache/chat_2.png",
    fileName: "two.png",
    caption: null,
  },
  {
    id: "chat/3",
    kind: "photo",
    url: null,
    fileName: "three.png",
    caption: null,
  },
];

function renderViewer(props: {
  item?: MediaViewerItem | null;
  index?: number;
  onNavigate?: (index: number) => void;
  onClose?: () => void;
  onSaveAs?: (item: MediaViewerItem) => void;
  onOpen?: (item: MediaViewerItem) => void;
}) {
  return render(
    <MediaViewer
      item={props.item === undefined ? items[0] : props.item}
      index={props.index ?? 0}
      count={items.length}
      origin={null}
      labels={labels}
      onNavigate={props.onNavigate ?? vi.fn()}
      onClose={props.onClose ?? vi.fn()}
      onSaveAs={props.onSaveAs ?? vi.fn()}
      onOpen={props.onOpen ?? vi.fn()}
    />,
  );
}

describe("MediaViewer", () => {
  it("renders nothing while closed", () => {
    renderViewer({ item: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the current photo with its caption in a modal dialog", () => {
    renderViewer({});
    const dialog = screen.getByRole("dialog", { name: labels.viewer });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "telo-media://cache/chat_1.png",
    );
    expect(screen.getByText("First photo")).toBeTruthy();
  });

  it("closes on Escape and on backdrop click, but not on media click", async () => {
    const onClose = vi.fn();
    renderViewer({ onClose });
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("img"));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("navigates with arrow keys and clamps at the ends", async () => {
    const onNavigate = vi.fn();
    renderViewer({ index: 0, onNavigate });
    await userEvent.keyboard("{ArrowLeft}");
    expect(onNavigate).not.toHaveBeenCalled();
    await userEvent.keyboard("{ArrowRight}");
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it("disables the previous button on the first and next on the last item", () => {
    const { rerender } = render(
      <MediaViewer
        item={items[0]}
        index={0}
        count={items.length}
        labels={labels}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
        onSaveAs={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: labels.previous }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: labels.next })).toHaveProperty(
      "disabled",
      false,
    );

    rerender(
      <MediaViewer
        item={items[2]}
        index={2}
        count={items.length}
        labels={labels}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
        onSaveAs={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: labels.next })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("shows a loading state while the media file is not cached", () => {
    renderViewer({ item: items[2], index: 2 });
    expect(screen.getByRole("status", { name: labels.loading })).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("wires the toolbar actions with the current item", async () => {
    const onSaveAs = vi.fn();
    const onOpen = vi.fn();
    renderViewer({ onSaveAs, onOpen });
    await userEvent.click(screen.getByRole("button", { name: labels.saveAs }));
    expect(onSaveAs).toHaveBeenCalledWith(items[0]);
    await userEvent.click(screen.getByRole("button", { name: labels.open }));
    expect(onOpen).toHaveBeenCalledWith(items[0]);
  });
});
