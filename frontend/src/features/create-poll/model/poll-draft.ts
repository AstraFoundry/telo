import {
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  type MessagePollKind,
  type SendPollInput,
} from "../../../../../contracts/src/ipc";

/**
 * The create-poll dialog's working state. Options are kept raw (untrimmed)
 * while typing; `pollInputFromDraft` normalizes for the wire.
 */
export interface PollDraft {
  readonly question: string;
  readonly options: ReadonlyArray<string>;
  readonly isAnonymous: boolean;
  readonly kind: MessagePollKind;
  readonly allowMultipleAnswers: boolean;
  /** 0-based index of the quiz's correct option. */
  readonly correctOptionId: number;
}

/** tdesktop's poll editor starts with two empty options. */
export function emptyPollDraft(): PollDraft {
  return {
    question: "",
    options: ["", ""],
    isAnonymous: true,
    kind: "regular",
    allowMultipleAnswers: false,
    correctOptionId: 0,
  };
}

export type PollDraftError =
  "question" | "options-count" | "option-empty" | "quiz-answer";

/**
 * The dialog's validation, mirrored main-side by the workspace service:
 * a non-empty question, 2-10 non-empty options (Telegram's
 * `poll_answer_count_max` is 10), and a quiz that names its correct option
 * because TDLib's `inputPollTypeQuiz` rejects an empty `correct_option_ids`.
 */
export function pollDraftError(draft: PollDraft): PollDraftError | null {
  if (!draft.question.trim()) return "question";
  if (
    draft.options.length < POLL_OPTIONS_MIN ||
    draft.options.length > POLL_OPTIONS_MAX
  ) {
    return "options-count";
  }
  if (draft.options.some((option) => !option.trim())) return "option-empty";
  if (
    draft.kind === "quiz" &&
    (draft.correctOptionId < 0 || draft.correctOptionId >= draft.options.length)
  ) {
    return "quiz-answer";
  }
  return null;
}

export function pollInputFromDraft(draft: PollDraft): SendPollInput {
  return {
    question: draft.question.trim(),
    options: draft.options.map((option) => option.trim()),
    isAnonymous: draft.isAnonymous,
    kind: draft.kind,
    // A quiz is always single-answer in Telegram.
    allowMultipleAnswers:
      draft.kind === "regular" ? draft.allowMultipleAnswers : false,
    correctOptionId: draft.kind === "quiz" ? draft.correctOptionId : undefined,
  };
}
