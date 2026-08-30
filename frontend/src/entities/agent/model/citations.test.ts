import { describe, expect, it } from "vitest";

import { parseCitations } from "./citations";

describe("parseCitations", () => {
  it("returns the body untouched when nothing is cited", () => {
    expect(parseCitations("Plain answer.")).toEqual({
      text: "Plain answer.",
      messageIds: [],
    });
  });

  it("collects citation ids in order and drops marker-only lines", () => {
    const body = [
      "Demo summary of 3 messages.",
      "[[telo-cite:design-4]]",
      "[[telo-cite:design-5]]",
      "[[telo-cite:design-6]]",
    ].join("\n");

    expect(parseCitations(body)).toEqual({
      text: "Demo summary of 3 messages.",
      messageIds: ["design-4", "design-5", "design-6"],
    });
  });

  it("deduplicates repeated citations of the same message", () => {
    const body = "A.\n[[telo-cite:m-1]]\nB.\n[[telo-cite:m-1]]";

    expect(parseCitations(body).messageIds).toEqual(["m-1"]);
  });

  it("removes inline markers without swallowing the surrounding text", () => {
    const body = "Ship it [[telo-cite:m-2]] tomorrow.";

    expect(parseCitations(body)).toEqual({
      text: "Ship it  tomorrow.",
      messageIds: ["m-2"],
    });
  });
});
