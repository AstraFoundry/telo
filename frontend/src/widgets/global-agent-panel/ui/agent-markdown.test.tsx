import "../../../shared/test/test-environment";

import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { MentionTarget } from "entities/chat";

import { collectReplyCitations } from "../model/reply-markdown";
import { AgentMarkdown } from "./agent-markdown";

const lev: MentionTarget = {
  kind: "person",
  id: "lev",
  name: "Lev",
  handle: "lev",
  avatarUrl: "telo-media://lev",
  avatarPending: false,
};

beforeAll(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
});

function renderMarkdown(body: string, streaming = false) {
  render(
    <AgentMarkdown
      body={body}
      streaming={streaming}
      citations={collectReplyCitations(body)}
      mentionTargets={new Map([["lev", lev]])}
      mentionNames={["Lev"]}
    />,
  );
}

describe("AgentMarkdown", () => {
  it("renders GFM prose and incomplete streaming emphasis semantically", () => {
    renderMarkdown(
      "## Result\n\n**Ready**\n\n- [x] Parsed\n- Safe\n\n| State | Value |\n| --- | --- |\n| Stream | On |\n\n**still streaming",
      true,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Result" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Ready").closest('[data-streamdown="strong"]'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        (_, element) =>
          element?.getAttribute("data-streamdown") === "strong" &&
          element.textContent === "still streaming",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("uses the beUI code block and keeps app syntax inside code literal", () => {
    renderMarkdown(
      "Before @Lev telo://message/design/1\n\n```ts\nconst ref = 'telo://message/code/2 @Lev';\n```",
    );

    const chip = screen.getByText(
      (_, element) =>
        element?.tagName === "SPAN" && element.textContent === "@Lev",
    );
    expect(chip).toBeTruthy();
    expect(chip.querySelector("img")?.getAttribute("src")).toBe(
      "telo-media://lev",
    );
    expect(
      screen.getByRole("link", { name: "Scroll to message 1" }),
    ).toBeTruthy();
    const code = screen.getByText(/const ref/).closest("[data-state]");
    expect(code?.getAttribute("data-state")).toBe("complete");
    expect(within(code as HTMLElement).getByText("typescript")).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: /Scroll to message/ }),
    ).toHaveLength(1);
  });

  it("allows safe external links and images but unwraps unsafe URLs and HTML", () => {
    const { container } = render(
      <AgentMarkdown
        body={
          "[Safe](https://example.com) [Unsafe](javascript:alert(1)) " +
          "![safe](https://example.com/a.png) ![unsafe](data:image/png;base64,abc) " +
          "<b>raw html</b>"
        }
        streaming={false}
        citations={[]}
        mentionTargets={new Map()}
        mentionNames={[]}
      />,
    );

    const safe = screen.getByRole("link", { name: "Safe" });
    expect(safe.getAttribute("href")).toBe("https://example.com/");
    expect(safe.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();
    expect(screen.getByAltText("safe").getAttribute("src")).toBe(
      "https://example.com/a.png",
    );
    expect(screen.queryByAltText("unsafe")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("preserves settled blocks when a streamed citation arrives", () => {
    const mentionTargets = new Map([["lev", lev]]);
    const mentionNames = ["Lev"];
    const initialBody = "## Stable heading\n\nSettled paragraph.";
    const { container, rerender } = render(
      <AgentMarkdown
        body={initialBody}
        streaming
        citations={[]}
        mentionTargets={mentionTargets}
        mentionNames={mentionNames}
      />,
    );
    const root = container.firstElementChild;
    const heading = screen.getByRole("heading", { name: "Stable heading" });

    const nextBody = `${initialBody}\n\nSource telo://message/design/1`;
    rerender(
      <AgentMarkdown
        body={nextBody}
        streaming
        citations={collectReplyCitations(nextBody)}
        mentionTargets={mentionTargets}
        mentionNames={mentionNames}
      />,
    );

    expect(container.firstElementChild).toBe(root);
    expect(screen.getByRole("heading", { name: "Stable heading" })).toBe(
      heading,
    );
    expect(container.querySelector("[data-sd-animate]")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Scroll to message 1" }),
    ).toBeTruthy();
  });

  it("upgrades a known mention without remounting unchanged Markdown", () => {
    const body = "Hello @Lev";
    const { container, rerender } = render(
      <AgentMarkdown
        body={body}
        streaming
        citations={[]}
        mentionTargets={new Map()}
        mentionNames={["Lev"]}
      />,
    );
    const root = container.firstElementChild;
    expect(container.querySelector("img")).toBeNull();

    rerender(
      <AgentMarkdown
        body={body}
        streaming
        citations={[]}
        mentionTargets={new Map([["lev", lev]])}
        mentionNames={["Lev"]}
      />,
    );

    expect(container.firstElementChild).toBe(root);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "telo-media://lev",
    );
  });
});
