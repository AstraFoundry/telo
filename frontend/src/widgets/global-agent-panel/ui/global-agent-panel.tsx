import { useEffect, useMemo, useState } from "react";

import {
  CaretDown,
  CaretRight,
  ClockCounterClockwise,
  Plus,
  Sparkle,
  X,
} from "@phosphor-icons/react";

import { useAgentStore } from "entities/agent";
import { buildWorkspaceContext, useChatStore } from "entities/chat";
import { useTimeFormat } from "entities/preferences";
import { copy } from "shared/config/copy";
import type {
  AgentAuditRecordDto,
  AgentContextPreviewDto,
  AgentContextScope,
  AgentContextScopeInput,
  TimeFormatPreference,
} from "../../../../../contracts/src/ipc";
import type { AgentActivityItem } from "shared/ui";
import {
  AgentActivity,
  AgentDisclosure,
  AnimatedSidebar,
  AnimatedSidebarProvider,
  Button,
  Message,
  MessageAvatar,
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

import { collectChatScope } from "../model/chat-scope";
import { buildScopeInput, effectiveScope } from "../model/scope-input";
import { AssistantMessageBody } from "./assistant-message-body";

interface GlobalAgentPanelProps {
  onOpenSettings(): void;
}

/**
 * The panel width is owned by the workspace layout container, which publishes
 * it as the --workspace-agent-panel-width custom property (persisted via the
 * agentPanelWidth preference and driven by the column resize handle). The
 * fallback matches AGENT_PANEL_WIDTH_DEFAULT for surfaces that render the
 * panel outside the workspace grid.
 */
const AGENT_PANEL_WIDTH = "var(--workspace-agent-panel-width, 380px)";

const SCOPE_LABELS: Record<AgentContextScope, string> = {
  selected: copy.agentScopeSelected,
  unread: copy.agentScopeUnread,
  folder: copy.agentScopeFolder,
};

function redactedTotal(counts: {
  emails: number;
  phones: number;
  tokens: number;
}): number {
  return counts.emails + counts.phones + counts.tokens;
}

// "system" defers to the locale's hour12 default, while 12h/24h pin it
// explicitly — the same formatter the transcript timestamps use.
function time(value: string, format: TimeFormatPreference): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(format === "system" ? {} : { hour12: format === "12h" }),
  }).format(new Date(value));
}

export function GlobalAgentPanel({ onOpenSettings }: GlobalAgentPanelProps) {
  const open = useAgentStore((state) => state.open);
  const close = useAgentStore((state) => state.close);
  const toggle = useAgentStore((state) => state.toggle);
  const messages = useAgentStore((state) => state.messages);
  const running = useAgentStore((state) => state.running);
  const activity = useAgentStore((state) => state.activity);
  const run = useAgentStore((state) => state.run);
  const runChatAction = useAgentStore((state) => state.runChatAction);
  const configuration = useAgentStore((state) => state.configuration);
  const threads = useAgentStore((state) => state.threads);
  const threadId = useAgentStore((state) => state.threadId);
  const loadThreads = useAgentStore((state) => state.loadThreads);
  const startNewThread = useAgentStore((state) => state.startNewThread);
  const selectThread = useAgentStore((state) => state.selectThread);
  const chats = useChatStore((state) => state.chats);
  const chatMessages = useChatStore((state) => state.messages);
  const activeChatId = useChatStore((state) => state.activeChatId);
  const activeFolderId = useChatStore((state) => state.activeFolderId);
  const composerTarget = useChatStore((state) => state.composerTarget);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  // Explicit context scope for panel runs. Unread (of the open chat) is the
  // default: the panel already answers about the open chat, and "summarize
  // unread" is the wave's headline flow, so it is the least surprising
  // starting scope. "Selected" means the composer's reply target until
  // multi-select exists (Wave 4); without one it is disabled.
  const [scope, setScope] = useState<AgentContextScope>("unread");
  const selectedMessageId =
    composerTarget?.mode === "reply" ? composerTarget.messageId : null;
  const currentScope = effectiveScope({
    scope,
    activeChatId,
    activeFolderId,
    selectedMessageId,
  });
  const scopeInput = useMemo(
    () =>
      buildScopeInput({
        scope,
        activeChatId,
        activeFolderId,
        selectedMessageId,
      }),
    [scope, activeChatId, activeFolderId, selectedMessageId],
  );

  // The payload preview is assembled and redacted main-side, so what the
  // disclosure lists is exactly what a run would send. It refetches as the
  // workspace changes to stay that way; a result is only shown while it
  // still matches the current scope input.
  const [previewResult, setPreviewResult] = useState<{
    key: AgentContextScopeInput;
    value: AgentContextPreviewDto | null;
    error: string | null;
  } | null>(null);
  const unreadWithoutChat = currentScope === "unread" && !activeChatId;
  useEffect(() => {
    if (!open || unreadWithoutChat) return;
    let cancelled = false;
    const key = scopeInput;
    void window.telo.agent.previewContext(key).then(
      (value) => {
        if (!cancelled) setPreviewResult({ key, value, error: null });
      },
      (error: unknown) => {
        if (!cancelled) {
          setPreviewResult({
            key,
            value: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, unreadWithoutChat, scopeInput, chats, chatMessages]);
  const preview = unreadWithoutChat
    ? {
        scope: "unread" as const,
        messages: [],
        redactionCounts: { emails: 0, phones: 0, tokens: 0 },
      }
    : previewResult?.key === scopeInput
      ? previewResult.value
      : null;
  const previewError = unreadWithoutChat
    ? null
    : previewResult?.key === scopeInput
      ? previewResult.error
      : null;

  // The audit list loads with the panel and refreshes when a run settles.
  const [auditRecords, setAuditRecords] = useState<
    ReadonlyArray<AgentAuditRecordDto>
  >([]);
  useEffect(() => {
    if (running) return;
    let cancelled = false;
    void window.telo.agent.listAuditRecords().then((records) => {
      if (!cancelled) setAuditRecords(records);
    });
    return () => {
      cancelled = true;
    };
  }, [running]);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const { value: timeFormat } = useTimeFormat();
  // Chat titles only add noise in a single-chat scope; they appear once the
  // payload actually spans several chats (folder scope).
  const previewSpansChats = preview
    ? new Set(preview.messages.map((message) => message.chatId)).size > 1
    : false;

  // The chat-scoped actions read the unread tail of the open chat (or the
  // loaded page when the read boundary is unknown); an empty scope disables
  // them rather than sending nothing to the model.
  const chatScope = useMemo(
    () =>
      collectChatScope(
        chats.find((chat) => chat.id === activeChatId) ?? null,
        chatMessages,
      ),
    [chats, chatMessages, activeChatId],
  );

  const lastMessage = messages[messages.length - 1];
  // While a run is active and no response text has streamed yet, the
  // transcript shows the live activity row instead of an empty shell.
  const awaitingResponse =
    running && !(lastMessage?.from === "assistant" && lastMessage.body);
  const activityItems: AgentActivityItem[] = activity
    ? [
        {
          id: "current-activity",
          type: "step",
          label: activity,
          status: "active",
        },
      ]
    : [];

  return (
    <AnimatedSidebarProvider
      open={open}
      openMobile={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen !== open) toggle();
      }}
      onOpenMobileChange={(nextOpen) => {
        if (nextOpen !== open) toggle();
      }}
      style={{ "--sidebar-width": AGENT_PANEL_WIDTH }}
    >
      <AnimatedSidebar
        side="right"
        collapsible="offcanvas"
        ariaLabel={copy.agent}
        aria-hidden={!open}
        inert={!open}
        className="overflow-hidden"
        // The panel sits directly on the shell background like the left
        // sidebar; the central card's shadow carries the separation, so the
        // vendored border-l and card background are overridden here.
        panelClassName="border-l-0 bg-transparent"
      >
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
          <Sparkle className="size-5 text-muted-foreground" />
          {/* deslop-ignore-next-line 12 */}
          <h2 className="min-w-0 flex-1 text-base font-semibold">
            {copy.agent}
          </h2>
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
        ) : !configuration.hasApiKey ? (
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
            <MessageScroller
              label={copy.agentConversation}
              busy={running}
              className="min-h-0 flex-1"
              contentClassName="flex flex-col gap-4 px-4 py-4"
            >
              {!messages.length ? (
                <div className="grid min-h-48 place-items-center px-8 text-center text-sm text-muted-foreground">
                  {copy.agentEmpty}
                </div>
              ) : null}
              {messages.map((message, index) => {
                const streaming = running && index === messages.length - 1;
                // An empty assistant shell is either the not-yet-streaming
                // placeholder (the activity row below stands in for it) or the
                // leftover of a failed run; neither renders a row.
                if (message.from === "assistant" && !message.body) {
                  return null;
                }
                return (
                  <Message key={message.id} from={message.from}>
                    {message.from === "assistant" ? (
                      <MessageAvatar>
                        <Sparkle />
                      </MessageAvatar>
                    ) : null}
                    <MessageContent>
                      {message.from === "assistant" ? (
                        <AssistantMessageBody
                          message={message}
                          streaming={streaming}
                          running={running}
                        />
                      ) : (
                        <MessageBubble variant="tint">
                          <MessageBubbleContent>
                            {message.body}
                          </MessageBubbleContent>
                        </MessageBubble>
                      )}
                    </MessageContent>
                  </Message>
                );
              })}
              {awaitingResponse ? (
                <Message from="assistant">
                  <MessageAvatar>
                    <Sparkle />
                  </MessageAvatar>
                  <MessageContent>
                    <AgentActivity
                      status="working"
                      contentType="step"
                      items={activityItems}
                      activeLabel={copy.activityDefault}
                    />
                  </MessageContent>
                </Message>
              ) : null}
            </MessageScroller>
            <div className="border-t p-3">
              {/* Chat-scoped actions: the scope (unread tail of the open chat)
                  is collected from the chat store and sent main-side, where
                  the use case assembles the machine prompt. */}
              <div className="mb-2 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={running || !chatScope}
                  onClick={() => {
                    if (!chatScope) return;
                    void runChatAction(
                      "summary",
                      chatScope,
                      buildWorkspaceContext(),
                    );
                  }}
                >
                  {copy.agentSummarizeUnread}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={running || !chatScope}
                  onClick={() => {
                    if (!chatScope) return;
                    void runChatAction(
                      "extraction",
                      chatScope,
                      buildWorkspaceContext(),
                    );
                  }}
                >
                  {copy.agentExtractInsights}
                </Button>
              </div>
              {/* Scope controls: the user picks exactly which messages the
                  run reads; the preview below shows the redacted payload
                  main-side assembly produces for that scope. */}
              <div className="mb-2 flex flex-col gap-1">
                <div
                  role="group"
                  aria-label={copy.agentScopeLabel}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-xs text-muted-foreground">
                    {copy.agentScopeLabel}
                  </span>
                  <div className="flex rounded-full border border-border p-0.5">
                    {(
                      ["selected", "unread", "folder"] as AgentContextScope[]
                    ).map((option) => {
                      const unavailable =
                        option === "selected" && !selectedMessageId;
                      const button = (
                        <Button
                          key={option}
                          variant="ghost"
                          size="sm"
                          aria-pressed={currentScope === option}
                          disabled={unavailable || running}
                          className={`rounded-full px-2.5${
                            currentScope === option
                              ? " bg-primary/10 text-foreground"
                              : ""
                          }`}
                          onClick={() => setScope(option)}
                        >
                          {SCOPE_LABELS[option]}
                        </Button>
                      );
                      // A disabled button swallows pointer events, so the
                      // hint tooltip hangs on the wrapper instead.
                      return unavailable ? (
                        <Tooltip
                          key={option}
                          content={copy.agentScopeSelectedHint}
                        >
                          <span className="inline-flex">{button}</span>
                        </Tooltip>
                      ) : (
                        button
                      );
                    })}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={previewOpen}
                  aria-label={copy.agentPayloadPreview}
                  className="w-full justify-between px-1.5 text-xs text-muted-foreground"
                  onClick={() => setPreviewOpen(!previewOpen)}
                >
                  <span className="flex items-center gap-1">
                    {previewOpen ? <CaretDown /> : <CaretRight />}
                    {copy.agentPayloadPreview}
                  </span>
                  {preview ? (
                    <span className="tabular-nums">
                      {preview.messages.length}
                    </span>
                  ) : null}
                </Button>
                <AgentDisclosure open={previewOpen}>
                  <div className="px-1.5 pb-1">
                    {previewError ? (
                      <p className="text-xs text-muted-foreground">
                        {previewError}
                      </p>
                    ) : !preview ? (
                      <p className="text-xs text-muted-foreground">
                        {copy.loading}
                      </p>
                    ) : preview.messages.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {copy.agentPayloadEmpty}
                      </p>
                    ) : (
                      <>
                        <ul className="flex max-h-40 flex-col gap-2 overflow-y-auto">
                          {preview.messages.map((message) => (
                            <li
                              key={message.messageId}
                              className="flex flex-col"
                            >
                              <span className="flex items-baseline justify-between gap-2 text-xs">
                                <span className="truncate font-medium">
                                  {message.senderName}
                                  {previewSpansChats
                                    ? ` · ${message.chatTitle}`
                                    : ""}
                                </span>
                                <span className="shrink-0 text-muted-foreground">
                                  {message.messageId}
                                </span>
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {message.body}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {redactedTotal(preview.redactionCounts) > 0 ? (
                          <p className="pt-1 text-xs tabular-nums text-muted-foreground">
                            {redactedTotal(preview.redactionCounts)}{" "}
                            {copy.agentRedactedFields}
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                </AgentDisclosure>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={runsOpen}
                  aria-label={copy.agentRecentRuns}
                  className="w-full justify-between px-1.5 text-xs text-muted-foreground"
                  onClick={() => setRunsOpen(!runsOpen)}
                >
                  <span className="flex items-center gap-1">
                    {runsOpen ? <CaretDown /> : <CaretRight />}
                    {copy.agentRecentRuns}
                  </span>
                  <span className="tabular-nums">{auditRecords.length}</span>
                </Button>
                <AgentDisclosure open={runsOpen}>
                  <div className="px-1.5 pb-1">
                    {auditRecords.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {copy.agentNoRuns}
                      </p>
                    ) : (
                      <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                        {auditRecords.slice(0, 5).map((record) => (
                          <li
                            key={record.id}
                            className="flex items-baseline justify-between gap-2 text-xs"
                          >
                            <span className="truncate">
                              {SCOPE_LABELS[record.scope]} ·{" "}
                              {record.messageIds.length}
                              {redactedTotal(record.redactionCounts) > 0
                                ? ` · ${redactedTotal(record.redactionCounts)} ${copy.agentRedactedFields}`
                                : ""}
                            </span>
                            <time className="shrink-0 tabular-nums text-muted-foreground">
                              {time(record.timestamp, timeFormat)}
                            </time>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </AgentDisclosure>
              </div>
              <PromptInput
                minRows={1}
                maxRows={6}
                loading={running}
                placeholder={copy.askAgent}
                aria-label={copy.askAgent}
                onSubmit={(prompt) =>
                  run(prompt, buildWorkspaceContext(), scopeInput)
                }
              />
            </div>
          </>
        )}
      </AnimatedSidebar>
    </AnimatedSidebarProvider>
  );
}
