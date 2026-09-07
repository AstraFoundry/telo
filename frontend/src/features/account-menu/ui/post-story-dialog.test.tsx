import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { copy } from "shared/config/copy";
import { installTeloApiMock } from "shared/test/mock-telo";

import { PostStoryDialog } from "./post-story-dialog";

describe("PostStoryDialog", () => {
  beforeEach(() => {
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["story"], { type: "image/jpeg" })),
    );
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:story"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("frames and posts a photo story with explicit privacy", async () => {
    const telo = installTeloApiMock();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<PostStoryDialog open onOpenChange={onOpenChange} />);

    await user.upload(
      screen.getByLabelText(copy.storyMedia),
      new File(["photo"], "landscape.png", { type: "image/png" }),
    );
    await user.type(screen.getByLabelText(copy.storyCaption), "A quiet day");
    await user.click(screen.getByRole("button", { name: copy.postStory }));

    await waitFor(() => expect(telo.workspace.postStory).toHaveBeenCalled());
    const [file, input] = telo.workspace.postStory.mock.calls[0];
    expect(file).toMatchObject({
      name: "landscape.jpg",
      type: "image/jpeg",
    });
    expect(input).toMatchObject({
      caption: "A quiet day",
      privacy: "contacts",
      activePeriod: 86400,
      protectContent: false,
    });
  });
});
