import { useCallback, useEffect, useMemo, useState } from "react";

import { ClockCounterClockwise, Plus, Sparkle, X } from "@phosphor-icons/react";

import type { ChatMemberDto } from "../../../../../contracts/src/ipc";
import { parseReply, useAgentStore } from "entities/agent";
import {
  buildMentionTargets,
  buildWorkspaceContext,
  useChatStore,
} from "entities/chat";
import { copy } from "shared/config/copy";
import {
  Button,
  MentionAutocomplete,
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
  MessageScroller,
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
  PromptInput,
  Tooltip,
} from "shared/ui";

import { useMentionPicker } from "../lib/use-mention-picker";
import { collectChatScope } from "../model/chat-scope";
import { indexMentionTargets, toMentionItems } from "../model/mention-items";
import { buildScopeInput } from "../model/scope-input";
import { AssistantMessageBody } from "./assistant-message-body";
import { AttachedMessageCards } from "./attached-message-cards";
import { ReplyText } from "./reply-text";
import { ResponseSkeleton } from "./response-skeleton";
import { RunFailedRow } from "./run-failed-row";
import { type Suggestion, SuggestionPills } from "./suggestion-pills";

interface GlobalAgentPanelProps {
  onOpenSettings(): void;
}

export function GlobalAgentPanel({ onOpenSettings }: GlobalAgentPanelProps) {
  const open = useAgentStore((state) => state.open);
  const close = useAgentStore((state) => state.close);
  const messages = useAgentStore((state) => state.messages);
  const running = useAgentStore((state) => state.running);
  const runFailed = useAgentStore((state) => state.runFailed);
  const activity = useAgentStore((state) => state.activity);
  const attachments = useAgentStore((state) => state.attachments);
  const followUps = useAgentStore((state) => state.suggestions);
  const detachMessage = useAgentStore((state) => state.detachMessage);
  const run = useAgentStore((state) => state.run);
  const runChatAction = useAgentStore((state) => state.runChatAction);
  const retryLastRun = useAgentStore((state) => state.retryLastRun);
  const configuration = useAgentStore((state) => state.configuration);
  const threads = useAgentStore((state) => state.threads);
  const threadId = useAgentStore((state) => state.threadId);
  const loadThreads = useAgentStore((state) => state.loadThreads);
  const startNewThread = useAgentStore((state) => state.startNewThread);
  const selectThread = useAgentStore((state) => state.selectThread);
  const chats = useChatStore((state) => state.chats);
  const chatMessages = useChatStore((state) => state.messages);
  const peerAvatars = useChatStore((state) => state.peerAvatars);
  const activeChatId = useChatStore((state) => state.activeChatId);
  const activeFolderId = useChatStore((state) => state.activeFolderId);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [followingLiveEdge, setFollowingLiveEdge] = useState(true);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  // Members of the open chat complete `@` in the composer alongside the
  // authors already on screen; the list is fetched once per chat while the
  // panel is open and dropped when the chat changes.
  const [members, setMembers] = useState<{
    readonly chatId: string;
    readonly list: ReadonlyArray<ChatMemberDto>;
  } | null>(null);
  useEffect(() => {
    if (!open || !activeChatId) return;
    let cancelled = false;
    void window.telo.workspace.listChatMembers(activeChatId).then((list) => {
      if (!cancelled) setMembers({ chatId: activeChatId, list });
    });
    return () => {
      cancelled = true;
    };
  }, [open, activeChatId]);

  const mentionTargets = useMemo(
    () =>
      buildMentionTargets({
        chats,
        messages: chatMessages,
        peerAvatars,
        members: members?.chatId === activeChatId ? members.list : [],
      }),
    [chats, chatMessages, peerAvatars, members, activeChatId],
  );
  const targetsByName = useMemo(
    () => indexMentionTargets(mentionTargets),
    [mentionTargets],
  );
  const mentionItems = useMemo(
    () => toMentionItems(mentionTargets),
    [mentionTargets],
  );
  const picker = useMentionPicker(mentionItems);

  // The run's scope follows the workspace instead of a picker: cards in the
  // composer, otherwise the open chat's unread tail, otherwise the folder.
  const scopeInput = useMemo(
    () => buildScopeInput({ attachments, activeChatId, activeFolderId }),
    [attachments, activeChatId, activeFolderId],
  );

  // Failed runs leave their diagnostics main-side; the transcript only ever
  // shows model replies, so persisted error rows are skipped too.
  const visibleMessages = messages.filter(
    (message) =>
      !(message.from === "assistant" && (message.error || !message.body)),
  );
  const lastMessage = messages[messages.length - 1];
  // While a run is active and no response text has streamed yet, the
  // transcript holds the reply's place with a skeleton.
  const awaitingResponse =
    running && !(lastMessage?.from === "assistant" && lastMessage.body);

  // Before the first exchange the pills are the chat's starting points; from
  // then on they are the follow-ups the model proposed for its last reply.
  const chatScope = useMemo(
    () =>
      collectChatScope(
        chats.find((chat) => chat.id === activeChatId) ?? null,
        chatMessages,
      ),
    [chats, chatMessages, activeChatId],
  );
  const suggestions = useMemo<ReadonlyArray<Suggestion>>(() => {
    if (attachments.length > 0 || running) return [];
    if (followUps.length > 0) {
      return followUps.map((label) => ({
        id: label,
        label,
        onSelect: () => void run(label, buildWorkspaceContext(), scopeInput),
      }));
    }
    if (visibleMessages.length > 0 || !chatScope) return [];
    return [
      {
        id: "summary",
        label: copy.agentSummarizeUnread,
        onSelect: () =>
          void runChatAction("summary", chatScope, buildWorkspaceContext()),
      },
      {
        id: "extraction",
        label: copy.agentExtractInsights,
        onSelect: () =>
          void runChatAction("extraction", chatScope, buildWorkspaceContext()),
      },
    ];
  }, [
    attachments.length,
    running,
    followUps,
    visibleMessages.length,
    chatScope,
    run,
    runChatAction,
    scopeInput,
  ]);

  const jumpToLatest = useCallback(() => {
    setFollowingLiveEdge(true);
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="window-titlebar-safe flex h-14 shrink-0 items-center gap-2 border-b">
        <Sparkle className="size-5 text-muted-foreground" />
        {/* deslop-ignore-next-line 12 */}
        <h2 className="min-w-0 flex-1 text-base font-semibold">{copy.agent}</h2>
        {/* Session-level controls only; provider configuration stays in
              Settings. They are disabled mid-run so a thread switch cannot
              reroute the live event stream into another transcript. */}
        <MorphPopover open={historyOpen} onOpenChange={setHistoryOpen}>
          <MorphPopoverTrigger>
            <Button
              size="icon"
              variant="ghost"
              aria-label={copy.agentHistory}
              disabled={running}
              className="size-10"
            >
              <ClockCounterClockwise />
            </Button>
          </MorphPopoverTrigger>
          <MorphPopoverContent align="end" className="w-64 p-1">
            {threads.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                {copy.agentNoHistory}
              </p>
            ) : (
              <ul className="flex flex-col">
                {threads.map((thread) => (
                  <li key={thread.threadId}>
                    <Button
                      variant="ghost"
                      className="w-full justify-start truncate"
                      aria-current={
                        thread.threadId === threadId ? "true" : undefined
                      }
                      onClick={() => {
                        setHistoryOpen(false);
                        void selectThread(thread.threadId);
                      }}
                    >
                      {thread.title || copy.agentNewThread}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </MorphPopoverContent>
        </MorphPopover>
        <Tooltip content={copy.agentNewThread}>
          <Button
            size="icon"
            variant="ghost"
            aria-label={copy.agentNewThread}
            disabled={running}
            className="size-10"
            onClick={() => void startNewThread()}
          >
            <Plus />
          </Button>
        </Tooltip>
        <Tooltip content={copy.closeAgent}>
          <Button
            size="icon"
            variant="ghost"
            aria-label={copy.closeAgent}
            className="size-10"
            onClick={close}
          >
            <X />
          </Button>
        </Tooltip>
      </header>

      {configuration === null ? (
        <div className="grid min-h-0 flex-1 place-items-center text-sm text-muted-foreground">
          {copy.loading}
        </div>
      ) : !configuration.hasCredential ? (
        <div className="grid min-h-0 flex-1 place-items-center px-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <Sparkle className="size-8 text-muted-foreground" />
            <p className="text-sm font-semibold">{copy.agentNotConfigured}</p>
            <p className="text-sm text-muted-foreground">
              {copy.agentNotConfiguredBody}
            </p>
            <Button variant="outline" size="sm" onClick={onOpenSettings}>
              {copy.agentNotConfiguredAction}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <MessageScroller
              label={copy.agentConversation}
              busy={running}
              followOutput={followingLiveEdge}
              onFollowChange={setFollowingLiveEdge}
              className="min-h-0 flex-1"
              // Bottom padding keeps the last reply clear of the floating
              // pill strip (28px) and its offset.
              contentClassName="flex flex-col gap-4 px-4 pt-4 pb-14"
            >
              {!visibleMessages.length && !awaitingResponse ? (
                <div className="grid min-h-48 place-items-center px-8 text-center text-sm text-muted-foreground">
                  {copy.agentEmpty}
                </div>
              ) : null}
              {visibleMessages.map((message, index) => {
                const streaming =
                  running && index === visibleMessages.length - 1;
                return (
                  <Message key={message.id} from={message.from}>
                    <MessageContent>
                      {message.from === "assistant" ? (
                        <AssistantMessageBody
                          message={message}
                          streaming={streaming}
                          running={running}
                          mentionTargets={targetsByName}
                        />
                      ) : (
                        <MessageBubble variant="tint">
                          <MessageBubbleContent>
                            <ReplyText
                              segments={
                                parseReply(message.body, [
                                  ...targetsByName.keys(),
                                ]).segments
                              }
                              targets={targetsByName}
                            />
                          </MessageBubbleContent>
                        </MessageBubble>
                      )}
                    </MessageContent>
                  </Message>
                );
              })}
              {awaitingResponse ? (
                <Message from="assistant">
                  <MessageContent>
                    <ResponseSkeleton activity={activity} />
                  </MessageContent>
                </Message>
              ) : null}
              {runFailed && !running ? (
                <Message from="assistant">
                  <MessageContent>
                    <RunFailedRow onRetry={() => void retryLastRun()} />
                  </MessageContent>
                </Message>
              ) : null}
            </MessageScroller>
            <SuggestionPills
              suggestions={suggestions}
              disabled={running}
              showJump={!followingLiveEdge}
              onJump={jumpToLatest}
            />
          </div>
          <div className="relative border-t p-3">
            <div className="relative">
              <MentionAutocomplete
                id={picker.listboxId}
                items={picker.matches}
                activeIndex={picker.activeIndex}
                onHover={picker.setActiveIndex}
                onPick={picker.pick}
              />
              <PromptInput
                minRows={1}
                maxRows={6}
                loading={running}
                placeholder={copy.askAgent}
                aria-label={copy.askAgent}
                value={picker.value}
                onValueChange={picker.setValue}
                inputRef={picker.inputRef}
                {...picker.textareaProps}
                attachmentPreview={
                  <AttachedMessageCards
                    items={attachments}
                    disabled={running}
                    onRemove={detachMessage}
                  />
                }
                onSubmit={(prompt) => {
                  picker.setValue("");
                  return run(prompt, buildWorkspaceContext(), scopeInput);
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
