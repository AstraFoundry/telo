import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type {
  MessageDto,
  MessagePollDto,
} from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import { installTeloApiMock } from "shared/test/mock-telo";

import { PollMessage } from "./poll-message";

function poll(partial: Partial<MessagePollDto> = {}): MessagePollDto {
  return {
    id: "poll-1",
    question: "Ship it?",
    options: [
      { id: "a", text: "Yes", voterCount: 0, votePercentage: 0, chosen: false },
      { id: "b", text: "No", voterCount: 0, votePercentage: 0, chosen: false },
    ],
    totalVoterCount: 0,
    isAnonymous: true,
    isClosed: false,
    kind: "regular",
    allowMultipleAnswers: false,
    correctOptionIds: null,
    ...partial,
  };
}

function messageWithPoll(pollDto: MessagePollDto): MessageDto {
  return {
    id: "m-1",
    chatId: "chat-1",
    senderName: "Mina",
    senderId: "peer-mina",
    senderAvatarUrl: null,
    body: "",
    entities: [],
    media: null,
    groupedId: null,
    sentAt: "2026-01-01T10:00:00.000Z",
    outgoing: false,
    status: "read",
    poll: pollDto,
  };
}

describe("PollMessage", () => {
  it("renders the question, subtitle, and votable options", () => {
    installTeloApiMock();
    render(<PollMessage message={messageWithPoll(poll())} />);

    expect(screen.getByText(copy.pollAnonymousPoll)).toBeDefined();
    expect(screen.getByText("Ship it?")).toBeDefined();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByText(copy.pollNoVotes)).toBeDefined();
  });

  it("votes on tap for a single-answer poll", async () => {
    const telo = installTeloApiMock();
    const user = userEvent.setup();
    render(<PollMessage message={messageWithPoll(poll())} />);

    await user.click(screen.getByRole("radio", { name: /No/ }));

    expect(telo.workspace.setMessagePollAnswer).toHaveBeenCalledWith(
      "chat-1",
      "m-1",
      [1],
    );
  });

  it("collects multiple answers behind the Vote button", async () => {
    const telo = installTeloApiMock();
    const user = userEvent.setup();
    render(
      <PollMessage
        message={messageWithPoll(poll({ allowMultipleAnswers: true }))}
      />,
    );

    const vote = screen.getByRole("button", { name: copy.pollVote });
    expect((vote as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: /Yes/ }));
    await user.click(screen.getByRole("checkbox", { name: /No/ }));
    await user.click(vote);

    expect(telo.workspace.setMessagePollAnswer).toHaveBeenCalledWith(
      "chat-1",
      "m-1",
      [0, 1],
    );
  });

  it("shows tallies instead of buttons once the account voted", () => {
    installTeloApiMock();
    render(
      <PollMessage
        message={messageWithPoll(
          poll({
            options: [
              {
                id: "a",
                text: "Yes",
                voterCount: 3,
                votePercentage: 75,
                chosen: true,
              },
              {
                id: "b",
                text: "No",
                voterCount: 1,
                votePercentage: 25,
                chosen: false,
              },
            ],
            totalVoterCount: 4,
          }),
        )}
      />,
    );

    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("75%")).toBeDefined();
    expect(screen.getByText(`4 ${copy.pollVotes}`)).toBeDefined();
  });

  it("reveals the quiz's correct option after answering, marking a wrong pick", () => {
    installTeloApiMock();
    render(
      <PollMessage
        message={messageWithPoll(
          poll({
            kind: "quiz",
            correctOptionIds: [1],
            options: [
              {
                id: "a",
                text: "3",
                voterCount: 1,
                votePercentage: 50,
                chosen: true,
              },
              {
                id: "b",
                text: "4",
                voterCount: 1,
                votePercentage: 50,
                chosen: false,
              },
            ],
            totalVoterCount: 2,
          }),
        )}
      />,
    );

    // An anonymous quiz subtitles itself accordingly.
    expect(screen.getByText(copy.pollAnonymousQuiz)).toBeDefined();
    // The reveal replaces the voting rows with results.
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getAllByText("50%")).toHaveLength(2);
  });

  it("reads a closed poll as final results and offers no vote", () => {
    installTeloApiMock();
    render(<PollMessage message={messageWithPoll(poll({ isClosed: true }))} />);

    expect(screen.queryByRole("radio")).toBeNull();
    expect(
      screen.getByText(`${copy.pollFinalResults} · 0 ${copy.pollVotes}`),
    ).toBeDefined();
  });

  it("surfaces a failed vote inline", async () => {
    const telo = installTeloApiMock();
    telo.workspace.setMessagePollAnswer.mockRejectedValue(new Error("closed"));
    const user = userEvent.setup();
    render(<PollMessage message={messageWithPoll(poll())} />);

    await user.click(screen.getByRole("radio", { name: /Yes/ }));

    await waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(
        copy.pollVoteFailed,
      ),
    );
  });
});
