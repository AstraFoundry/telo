import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { copy } from "shared/config/copy";

import { CreatePollDialog } from "./create-poll-dialog";

function renderDialog(onSubmit = vi.fn(async () => undefined)) {
  const onClose = vi.fn();
  render(<CreatePollDialog open onClose={onClose} onSubmit={onSubmit} />);
  return { onSubmit, onClose };
}

function alertText(): string | null {
  return document.querySelector('[role="alert"]')?.textContent ?? null;
}

function optionInput(index: number): HTMLElement {
  return screen.getByLabelText(`${copy.pollOptionPlaceholder} ${index}`);
}

function fillPoll(question: string, options: ReadonlyArray<string>): void {
  fireEvent.change(screen.getByLabelText(copy.pollQuestion), {
    target: { value: question },
  });
  options.forEach((option, index) => {
    fireEvent.change(optionInput(index + 1), { target: { value: option } });
  });
}

function optionRemoveButtons(): Array<HTMLButtonElement> {
  return screen
    .getAllByRole("button", { name: /Remove option/ })
    .map((element) => element as HTMLButtonElement);
}

describe("CreatePollDialog", () => {
  it("rejects an empty question and keeps the dialog open", async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = renderDialog();

    fillPoll("", ["Yes", "No"]);
    await user.click(screen.getByRole("button", { name: copy.pollConfirm }));

    await waitFor(() => expect(alertText()).toBe(copy.pollQuestionRequired));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("rejects an empty option", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    fillPoll("Ship it?", ["Yes", ""]);
    await user.click(screen.getByRole("button", { name: copy.pollConfirm }));

    await waitFor(() => expect(alertText()).toBe(copy.pollOptionRequired));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("adds and removes options within Telegram's 2-10 bounds", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(optionRemoveButtons()).toHaveLength(2);
    expect(optionRemoveButtons()[0]?.disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: copy.addPollOption }));
    expect(optionRemoveButtons()).toHaveLength(3);

    await user.click(
      screen.getByRole("button", { name: `${copy.removePollOption} 3` }),
    );
    expect(optionRemoveButtons()).toHaveLength(2);
  });

  it("submits a normalized regular poll and closes", async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = renderDialog();

    fillPoll(" Ship it? ", [" Yes ", "No"]);
    await user.click(screen.getByRole("button", { name: copy.pollConfirm }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        question: "Ship it?",
        options: ["Yes", "No"],
        isAnonymous: true,
        kind: "regular",
        allowMultipleAnswers: false,
        correctOptionId: undefined,
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("offers the correct-answer picker and no multiple-answers switch for a quiz", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await user.click(screen.getByRole("radio", { name: copy.pollKindQuiz }));
    expect(
      screen.queryByRole("switch", { name: copy.pollMultipleAnswers }),
    ).toBeNull();

    fillPoll("2 + 2?", ["3", "4"]);
    await user.click(
      screen.getByRole("radio", {
        name: `${copy.pollCorrectAnswer}: ${copy.pollOptionPlaceholder} 2`,
      }),
    );
    await user.click(screen.getByRole("button", { name: copy.pollConfirm }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "quiz", correctOptionId: 1 }),
      ),
    );
  });

  it("surfaces a failed submit instead of closing", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog(vi.fn().mockRejectedValue(new Error("x")));

    fillPoll("Ship it?", ["Yes", "No"]);
    await user.click(screen.getByRole("button", { name: copy.pollConfirm }));

    await waitFor(() => expect(alertText()).toBe(copy.pollCreateFailed));
    expect(onClose).not.toHaveBeenCalled();
  });
});
