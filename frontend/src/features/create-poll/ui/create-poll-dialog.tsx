import { Plus, X } from "@phosphor-icons/react";
import { useState } from "react";

import {
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  type SendPollInput,
} from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalClose,
  CenterMorphModalContent,
  ErrorRow,
  Input,
  RadioGroup,
  RadioGroupItem,
  Switch,
} from "shared/ui";

import {
  emptyPollDraft,
  pollDraftError,
  pollInputFromDraft,
  type PollDraft,
  type PollDraftError,
} from "../model/poll-draft";

export interface CreatePollDialogProps {
  readonly open: boolean;
  onClose(): void;
  /** Receives the validated poll; rejection keeps the draft for a retry. */
  onSubmit(input: SendPollInput): Promise<void>;
}

const DRAFT_ERROR_COPY: Record<PollDraftError, string> = {
  question: copy.pollQuestionRequired,
  "options-count": copy.pollOptionsCount,
  "option-empty": copy.pollOptionRequired,
  "quiz-answer": copy.pollQuizNeedsAnswer,
};

/**
 * tdesktop's poll editor (attach menu → Poll), reduced to the fields Telo
 * supports: a question, 2-10 options with add/remove, a Poll/Quiz kind
 * toggle, anonymous voting, and multiple answers for a regular poll. A quiz
 * marks its correct option on the option row, because TDLib's
 * `inputPollTypeQuiz` cannot be created without one.
 */
export function CreatePollDialog({
  open,
  onClose,
  onSubmit,
}: CreatePollDialogProps) {
  const [wasOpen, setWasOpen] = useState(open);
  const [draft, setDraft] = useState<PollDraft>(emptyPollDraft);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Each open starts a fresh poll: the previous draft never bleeds in.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(emptyPollDraft());
      setError(null);
      setSubmitting(false);
    }
  }

  const update = (patch: Partial<PollDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    if (error) setError(null);
  };

  const setOption = (index: number, text: string) => {
    update({
      options: draft.options.map((option, i) => (i === index ? text : option)),
    });
  };

  const addOption = () => {
    if (draft.options.length >= POLL_OPTIONS_MAX) return;
    update({ options: [...draft.options, ""] });
  };

  const removeOption = (index: number) => {
    if (draft.options.length <= POLL_OPTIONS_MIN) return;
    update({
      options: draft.options.filter((_, i) => i !== index),
      // The correct-answer marker follows the surviving options; dropping
      // the marked option falls back to the first, like tdesktop.
      correctOptionId:
        draft.correctOptionId === index
          ? 0
          : draft.correctOptionId > index
            ? draft.correctOptionId - 1
            : draft.correctOptionId,
    });
  };

  const submit = async () => {
    const failure = pollDraftError(draft);
    if (failure) {
      setError(DRAFT_ERROR_COPY[failure]);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(pollInputFromDraft(draft));
      onClose();
    } catch {
      setError(copy.pollCreateFailed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CenterMorphModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <CenterMorphModalContent
        ariaLabel={copy.newPoll}
        closeButtonLabel={copy.closeDialog}
      >
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {/* deslop-ignore-next-line 12 */}
          <h2 className="text-base font-semibold">{copy.newPoll}</h2>
          <Input
            label={copy.pollQuestion}
            value={draft.question}
            placeholder={copy.pollQuestionPlaceholder}
            onChange={(next) => update({ question: next })}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{copy.pollOptions}</legend>
            {draft.options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                {draft.kind === "quiz" ? (
                  // In a quiz every option row doubles as the correct-answer
                  // picker (tdesktop draws a radio on the row's edge).
                  <button
                    type="button"
                    role="radio"
                    aria-checked={draft.correctOptionId === index}
                    aria-label={`${copy.pollCorrectAnswer}: ${copy.pollOptionPlaceholder} ${index + 1}`}
                    onClick={() => update({ correctOptionId: index })}
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/50 outline-none focus-visible:ring-2 focus-visible:ring-ring data-[checked]:border-primary"
                    data-checked={draft.correctOptionId === index || undefined}
                  >
                    {draft.correctOptionId === index ? (
                      <span className="size-2.5 rounded-full bg-primary" />
                    ) : null}
                  </button>
                ) : null}
                <Input
                  aria-label={`${copy.pollOptionPlaceholder} ${index + 1}`}
                  value={option}
                  placeholder={`${copy.pollOptionPlaceholder} ${index + 1}`}
                  onChange={(next) => setOption(index, next)}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`${copy.removePollOption} ${index + 1}`}
                  disabled={draft.options.length <= POLL_OPTIONS_MIN}
                  onClick={() => removeOption(index)}
                >
                  <X aria-hidden="true" className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              className="self-start"
              disabled={draft.options.length >= POLL_OPTIONS_MAX}
              onClick={addOption}
            >
              <Plus aria-hidden="true" className="size-4" />
              {copy.addPollOption}
            </Button>
          </fieldset>
          <RadioGroup
            orientation="horizontal"
            value={draft.kind}
            onValueChange={(next) =>
              update({ kind: next === "quiz" ? "quiz" : "regular" })
            }
          >
            <RadioGroupItem value="regular" label={copy.pollKindRegular} />
            <RadioGroupItem value="quiz" label={copy.pollKindQuiz} />
          </RadioGroup>
          <Switch
            checked={draft.isAnonymous}
            onCheckedChange={(checked) => update({ isAnonymous: checked })}
            label={copy.pollAnonymous}
          />
          {/* Multiple answers is a regular-poll flag; Telegram quizzes are
              always single-answer, so the switch leaves with the kind. */}
          {draft.kind === "regular" ? (
            <Switch
              checked={draft.allowMultipleAnswers}
              onCheckedChange={(checked) =>
                update({ allowMultipleAnswers: checked })
              }
              label={copy.pollMultipleAnswers}
            />
          ) : null}
          <ErrorRow message={error} />
          <div className="flex justify-end gap-2">
            <CenterMorphModalClose>
              <Button type="button" variant="ghost">
                {copy.cancel}
              </Button>
            </CenterMorphModalClose>
            <Button type="submit" variant="primary" disabled={submitting}>
              {copy.pollConfirm}
            </Button>
          </div>
        </form>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
