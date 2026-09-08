import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { copy } from "../config/copy";

import { Avatar } from "./avatar";

describe("Avatar", () => {
  it("shows a skeleton while the photo is pending and never letters", () => {
    const { container } = render(<Avatar pending className="size-10" />);

    expect(
      screen.getByRole("status", { name: copy.loadingAvatar }),
    ).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders the photo when a source is ready", () => {
    const src = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    const { container } = render(<Avatar src={src} className="size-10" />);

    expect(container.querySelector("img")?.getAttribute("src")).toBe(src);
  });

  it("renders an empty circle when the load has settled with no photo", () => {
    const { container } = render(<Avatar className="size-10" />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("falls back to the empty userpic when the photo source is dead", () => {
    // A stale telo-media URL after a cache clear must not pin the skeleton.
    const { container } = render(
      <Avatar
        src="telo-media://cache/evicted.jpg"
        placeholder={{
          glyph: "T",
          lightColors: ["#7BC862", "#6EC96C"],
          darkColors: ["#7BC862", "#6EC96C"],
        }}
        className="size-10"
      />,
    );

    fireEvent.error(container.querySelector("img")!);

    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("T");
  });

  it("paints the Saved Messages bookmark instead of a photo or skeleton", () => {
    const src = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    const { container } = render(
      <Avatar mark="saved" src={src} pending className="size-10" />,
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("paints a TDLib empty userpic glyph on the accent fill", () => {
    const { container } = render(
      <Avatar
        placeholder={{
          glyph: "T",
          lightColors: ["#7BC862", "#6EC96C"],
          darkColors: ["#7BC862", "#6EC96C"],
        }}
        className="size-10"
      />,
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("T");
  });

  it("paints an emoji glyph without uppercasing", () => {
    const { container } = render(
      <Avatar
        placeholder={{
          glyph: "🔥",
          lightColors: ["#E17076"],
          darkColors: ["#E17076"],
        }}
        className="size-10"
      />,
    );

    expect(container.textContent).toBe("🔥");
  });

  it("paints the empty userpic immediately while a photo is still pending", () => {
    const { container } = render(
      <Avatar
        pending
        placeholder={{
          glyph: "R",
          lightColors: ["#65AADD", "#54B3F0"],
          darkColors: ["#65AADD", "#54B3F0"],
        }}
        className="size-10"
      />,
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(container.textContent).toBe("R");
  });
});
