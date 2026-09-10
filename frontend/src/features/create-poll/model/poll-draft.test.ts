import { describe, expect, it } from "vitest";

import {
  emptyPollDraft,
  pollDraftError,
  pollInputFromDraft,
  type PollDraft,
} from "./poll-draft";

function draft(partial: Partial<PollDraft> = {}): PollDraft {
  return {
    ...emptyPollDraft(),
    question: "Ship it?",
    options: ["Yes", "No"],
    ...partial,
  };
}

describe("poll draft", () => {
  it("accepts a complete regular poll", () => {
    expect(pollDraftError(draft())).toBeNull();
    expect(pollInputFromDraft(draft())).toEqual({
      question: "Ship it?",
      options: ["Yes", "No"],
      isAnonymous: true,
      kind: "regular",
      allowMultipleAnswers: false,
      correctOptionId: undefined,
    });
  });

  it("trims the question and options", () => {
    const input = pollInputFromDraft(
      draft({ question: "  Lunch? ", options: [" In ", " Out "] }),
    );
    expect(input.question).toBe("Lunch?");
    expect(input.options).toEqual(["In", "Out"]);
  });

  it("requires a question, two to ten options, and no empty option", () => {
    expect(pollDraftError(draft({ question: "  " }))).toBe("question");
    expect(pollDraftError(draft({ options: ["Only"] }))).toBe("options-count");
    expect(
      pollDraftError(
        draft({
          options: Array.from({ length: 11 }, (_, i) => `Option ${i}`),
        }),
      ),
    ).toBe("options-count");
    expect(pollDraftError(draft({ options: ["Yes", " "] }))).toBe(
      "option-empty",
    );
  });

  it("requires a valid correct option for a quiz", () => {
    expect(
      pollDraftError(draft({ kind: "quiz", correctOptionId: 0 })),
    ).toBeNull();
    expect(pollDraftError(draft({ kind: "quiz", correctOptionId: 5 }))).toBe(
      "quiz-answer",
    );
    // A quiz is always single-answer in Telegram, whatever the toggle said.
    const input = pollInputFromDraft(
      draft({ kind: "quiz", allowMultipleAnswers: true, correctOptionId: 1 }),
    );
    expect(input.allowMultipleAnswers).toBe(false);
    expect(input.correctOptionId).toBe(1);
  });
});
