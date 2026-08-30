import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { copy } from "shared/config/copy";
import { MessageRichText } from "shared/ui";

describe("MessageRichText", () => {
  it("renders nested formatting and a safe external text link", () => {
    const { container } = render(
      <MessageRichText
        body="Read the docs"
        entities={[
          { type: "bold", offset: 0, length: 13 },
          {
            type: "text-link",
            offset: 9,
            length: 4,
            url: "https://example.com/docs",
          },
        ]}
        revealSpoilerLabel={copy.revealSpoiler}
      />,
    );

    expect(container.querySelector("strong")?.textContent).toBe(
      "Read the docs",
    );
    expect(
      screen.getByRole("link", { name: "docs" }).getAttribute("href"),
    ).toBe("https://example.com/docs");
  });

  it("uses Telegram UTF-16 offsets after astral emoji", () => {
    const { container } = render(
      <MessageRichText
        body="🙂 bold"
        entities={[{ type: "bold", offset: 3, length: 4 }]}
        revealSpoilerLabel={copy.revealSpoiler}
      />,
    );

    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.textContent).toBe("🙂 bold");
  });

  it("reveals spoiler content without an ornamental transition", () => {
    render(
      <MessageRichText
        body="hidden"
        entities={[{ type: "spoiler", offset: 0, length: 6 }]}
        revealSpoilerLabel={copy.revealSpoiler}
      />,
    );

    const reveal = screen.getByRole("button", { name: copy.revealSpoiler });
    fireEvent.click(reveal);
    expect(
      screen.queryByRole("button", { name: copy.revealSpoiler }),
    ).toBeNull();
    expect(screen.getByText("hidden")).toBeTruthy();
  });

  it("keeps links inside spoilers non-interactive until the text is revealed", () => {
    render(
      <MessageRichText
        body="secret link"
        entities={[
          { type: "spoiler", offset: 0, length: 11 },
          {
            type: "text-link",
            offset: 7,
            length: 4,
            url: "https://example.com",
          },
        ]}
        revealSpoilerLabel={copy.revealSpoiler}
      />,
    );

    expect(screen.queryByRole("link", { name: "link" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.revealSpoiler }));
    expect(screen.getByRole("link", { name: "link" })).toBeTruthy();
  });

  it("does not create links for unsafe protocols or malformed ranges", () => {
    const { container } = render(
      <MessageRichText
        body="open plain"
        entities={[
          {
            type: "text-link",
            offset: 0,
            length: 4,
            url: "javascript:alert(1)",
          },
          { type: "bold", offset: 8, length: 20 },
        ]}
        revealSpoilerLabel={copy.revealSpoiler}
      />,
    );

    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toBe("open plain");
  });
});
