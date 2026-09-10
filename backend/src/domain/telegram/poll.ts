/**
 * Poll vocabulary: transcript poll cards, voting, and poll creation.
 */

export type MessagePollKind = "regular" | "quiz";

/** One answer option of a poll (Telegram `pollOption`). */
export interface MessagePollOptionDto {
  /** TDLib's per-poll option id; may be empty before the server assigns it. */
  readonly id: string;
  readonly text: string;
  /**
   * Votes this option holds. TDLib only reports per-option counts once
   * results are visible (voted or closed polls, or the poll's creator).
   */
  readonly voterCount: number;
  /** Share of the vote, 0-100 (`pollOption.vote_percentage`). */
  readonly votePercentage: number;
  /** This account's current answer includes the option (`is_chosen`). */
  readonly chosen: boolean;
}

/**
 * A poll inside the transcript (Telegram `messagePoll`). tdesktop subtitles
 * the card from `isAnonymous` and `kind` ("Anonymous Poll", "Quiz", …) and
 * reveals the quiz's correct answer only once it can be known — that is the
 * rule `correctOptionIds` encodes.
 */
export interface MessagePollDto {
  readonly id: string;
  readonly question: string;
  readonly options: ReadonlyArray<MessagePollOptionDto>;
  readonly totalVoterCount: number;
  readonly isAnonymous: boolean;
  readonly isClosed: boolean;
  readonly kind: MessagePollKind;
  /**
   * Regular polls only (`poll.allows_multiple_answers`; quizzes are always
   * single-answer in Telegram).
   */
  readonly allowMultipleAnswers: boolean;
  /**
   * 0-based indexes of the correct options, for a quiz. TDLib ships
   * `correct_option_ids` empty for a yet unanswered poll, so this is null
   * until the account has answered or the poll is closed — and always null
   * for a regular poll (tdesktop's reveal rule).
   */
  readonly correctOptionIds?: ReadonlyArray<number> | null;
}

/** Telegram's poll option bounds (`poll_answer_count_max` is 10). */
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 10;

/**
 * Composer-authored poll for `sendPoll` (TDLib `inputMessagePoll` via
 * `sendMessage`; polls deliberately do not ride the text send path).
 */
export interface SendPollInput {
  readonly question: string;
  readonly options: ReadonlyArray<string>;
  readonly isAnonymous: boolean;
  readonly kind: MessagePollKind;
  /** Regular polls only; ignored for a quiz. */
  readonly allowMultipleAnswers: boolean;
  /**
   * 0-based index of the correct option. Required for a quiz — TDLib's
   * `inputPollTypeQuiz.correct_option_ids` must be non-empty, and tdesktop's
   * quiz editor makes picking the answer part of creating one.
   */
  readonly correctOptionId?: number;
}
