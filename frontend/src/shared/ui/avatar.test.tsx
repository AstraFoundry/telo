import { render, screen } from "@testing-library/react";
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
});
