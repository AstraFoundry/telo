import { Check, X } from "@phosphor-icons/react";
import { motion, useReducedMotionConfig } from "motion/react";
import { useState } from "react";

import type {
  MessageDto,
  MessagePollDto,
} from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import { cn } from "shared/lib/cn";
import { Button, EASE_OUT } from "shared/ui";

// tdesktop subtitles the card from anonymity and kind
// (HistoryView::PollData's "Anonymous Poll" / "Quiz" strings).
function pollSubtitle(poll: MessagePollDto): string {
  if (poll.kind === "quiz") {
    return poll.isAnonymous ? copy.pollAnonymousQuiz : copy.pollQuiz;
  }
  return poll.isAnonymous ? copy.pollAnonymousPoll : copy.pollPublicPoll;
}

/**
 * The transcript card for a `messagePoll` — tdesktop's
 * `HistoryView::PollData`. Renders inside the ordinary bubble surface: a
 * subtitle, the question in bold, then either the votable option rows or the
 * results. A regular single-answer poll and a quiz vote on tap; a
 * multiple-answers poll collects checkboxes behind a Vote button, matching
 * tdesktop's "VOTE" submit. Results show animated percentage bars with the
 * account's picks marked; a quiz reveals its correct option (green) and a
 * wrong pick (red) only once TDLib ships `correct_option_ids` — after the
 * account answered or the poll closed.
 *
 * The vote call answers with nothing; the fresh tally arrives as an
 * edited-message upsert and re-renders this card, so local state is only the
 * in-flight guard and the multiple-answers selection.
 */
export function PollMessage({ message }: { readonly message: MessageDto }) {
  const poll = message.poll!;
  const reduce = useReducedMotionConfig() ?? false;
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const answered = poll.options.some((option) => option.chosen);
  const voting = !answered && !poll.isClosed;
  const multiple = voting && poll.allowMultipleAnswers;

  const vote = async (optionIds: ReadonlyArray<number>) => {
    setPending(true);
    setError(null);
    try {
      await window.telo.workspace.setMessagePollAnswer(
        message.chatId,
        message.id,
        optionIds,
      );
    } catch {
      setError(copy.pollVoteFailed);
    } finally {
      setPending(false);
    }
  };

  const toggle = (index: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div
      data-slot="message-poll"
      className="flex w-full min-w-56 flex-col gap-1.5 py-0.5"
    >
      <div className="text-xs leading-none text-muted-foreground">
        {pollSubtitle(poll)}
      </div>
      <div className="font-semibold text-pretty">{poll.question}</div>
      <div role={voting ? "group" : undefined} className="flex flex-col">
        {poll.options.map((option, index) => {
          const revealed =
            poll.kind === "quiz" && poll.correctOptionIds != null;
          const correct = revealed && poll.correctOptionIds!.includes(index);
          const wrongPick =
            revealed &&
            option.chosen &&
            !poll.correctOptionIds!.includes(index);
          return (
            <div key={option.id || index} className="py-0.5">
              {voting ? (
                <button
                  type="button"
                  role={multiple ? "checkbox" : "radio"}
                  aria-checked={multiple ? selected.has(index) : false}
                  disabled={pending}
                  onClick={() =>
                    multiple ? toggle(index) : void vote([index])
                  }
                  className={cn(
                    "flex min-h-9 w-full items-center gap-3 text-left outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    pending ? "cursor-wait opacity-70" : "cursor-pointer",
                  )}
                >
                  {/* tdesktop draws the untouched ring/disc the option fills
                      on vote; the tally itself arrives with the edit event. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-flex size-5 shrink-0 items-center justify-center border-2 border-muted-foreground/50",
                      multiple ? "rounded-md" : "rounded-full",
                      selected.has(index) && "border-primary bg-primary",
                    )}
                  >
                    {multiple && selected.has(index) ? (
                      <Check
                        className="size-3.5 text-primary-foreground"
                        weight="bold"
                      />
                    ) : null}
                  </span>
                  <span className="text-sm">{option.text}</span>
                </button>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="flex min-h-6 items-center gap-2">
                    {revealed ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "inline-flex size-5 shrink-0 items-center justify-center rounded-full",
                          correct
                            ? "bg-primary text-primary-foreground"
                            : wrongPick
                              ? "bg-destructive/15 text-destructive"
                              : "text-muted-foreground/40",
                        )}
                      >
                        {correct ? (
                          <Check className="size-3.5" weight="bold" />
                        ) : wrongPick ? (
                          <X className="size-3.5" weight="bold" />
                        ) : null}
                      </span>
                    ) : (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                          option.chosen
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/40",
                        )}
                      >
                        {option.chosen ? (
                          <Check className="size-3.5" weight="bold" />
                        ) : null}
                      </span>
                    )}
                    <span
                      className={cn(
                        "flex-1 text-sm",
                        option.chosen && "font-medium",
                      )}
                    >
                      {option.text}
                    </span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {option.votePercentage}%
                    </span>
                  </div>
                  {/* The bar animates from zero as results land — the same
                      row replays when a vote's edited upsert moves it. */}
                  <div className="h-1 overflow-hidden rounded-full bg-muted-foreground/15">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${option.votePercentage}%` }}
                      transition={
                        reduce
                          ? { duration: 0 }
                          : { duration: 0.35, ease: EASE_OUT }
                      }
                      className={cn(
                        "h-full rounded-full",
                        wrongPick
                          ? "bg-destructive"
                          : option.chosen
                            ? "bg-primary"
                            : "bg-muted-foreground/40",
                      )}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {multiple ? (
        <Button
          variant="primary"
          className="mt-1 self-center"
          disabled={pending || selected.size === 0}
          onClick={() => void vote([...selected])}
        >
          {copy.pollVote}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="text-xs text-muted-foreground">
        {poll.isClosed
          ? `${copy.pollFinalResults} · ${poll.totalVoterCount} ${copy.pollVotes}`
          : poll.totalVoterCount === 0
            ? copy.pollNoVotes
            : `${poll.totalVoterCount} ${copy.pollVotes}`}
      </div>
    </div>
  );
}
