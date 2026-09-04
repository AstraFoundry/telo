import { describe, expect, it } from "vitest";

import {
  collectReplyCitations,
  replyMarkdownPlainText,
  withoutTrailingTeloLink,
} from "./reply-markdown";

describe("reply Markdown", () => {
  it("collects and deduplicates prose citations while leaving code literal", () => {
    const body = [
      "Use telo://message/design/1 and [the follow-up](telo://message/design/2).",
      "",
      "`telo://message/code/inline`",
      "",
      "```text",
      "telo://message/code/fenced",
      "```",
      "",
      "Again telo://message/design/1",
    ].join("\n");

    expect(collectReplyCitations(body)).toEqual([
      { chatId: "design", messageId: "1" },
      { chatId: "design", messageId: "2" },
    ]);
  });

  it("creates plain copy without Markdown syntax or citation URLs", () => {
    expect(
      replyMarkdownPlainText(
        "## Result\n\n**Ready** [now](https://example.com). telo://message/design/1",
      ),
    ).toBe("Result\nReady now.");
  });

  it("holds back only an unfinished trailing in-app link", () => {
    expect(withoutTrailingTeloLink("Ready telo://message/design/", true)).toBe(
      "Ready",
    );
    expect(
      withoutTrailingTeloLink("Ready telo://message/design/1", false),
    ).toBe("Ready telo://message/design/1");
  });
});
