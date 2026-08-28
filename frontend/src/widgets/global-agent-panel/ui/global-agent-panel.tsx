import { useEffect, useState } from "react";

import { ClockCounterClockwise, Plus, Sparkle, X } from "@phosphor-icons/react";

import { useAgentStore } from "entities/agent";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import type { UiContextSnapshot } from "../../../../../contracts/src/ipc";
import type { AgentActivityItem } from "shared/ui";
import {
  AgentActivity,
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
  StreamingResponse,
  Tooltip,
} from "shared/ui";

interface GlobalAgentPanelProps {
  onOpenSettings(): void;
}

/**
 * Single source for the panel width. The sidebar provider style and any
 * layout that depends on the panel width must reference this constant
 * (the OpenTrade `AGENT_PANEL_WIDTH` pattern).
 */
const AGENT_PANEL_WIDTH = "380px";

function buildWorkspaceContext(): UiContextSnapshot {
  const { chats, messages, activeChatId } = useChatStore.getState();
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;
  return {
    activeChat: activeChat
      ? { id: activeChat.id, title: activeChat.title, kind: activeChat.kind }
      : null,
    visibleChats: chats.map(({ id, title, unreadCount }) => ({
      id,
      title,
      unreadCount,
    })),
    visibleMessages: messages.map(({ senderName, body, sentAt, outgoing }) => ({
      senderName,
      body,
      sentAt,
      outgoing,
    })),
    components: [
      {
        id: "conversation-sidebar",
        role: "chat-navigation",
        state: { count: chats.length },
      },
      {
        id: "conversation-view",
        role: "message-transcript",
        state: { chatId: activeChatId, messageCount: messages.length },
      },
      { id: "global-agent-panel", role: "assistant", state: { visible: true } },
    ],
  };
}

export function GlobalAgentPanel({ onOpenSettings }: GlobalAgentPanelProps) {
  const open = useAgentStore((state) => state.open);
  const close = useAgentStore((state) => state.close);
  const toggle = useAgentStore((state) => state.toggle);
  const messages = useAgentStore((state) => state.messages);
  const running = useAgentStore((state) => state.running);
  const activity = useAgentStore((state) => state.activity);
  const run = useAgentStore((state) => state.run);
  const configuration = useAgentStore((state) => state.configuration);
  const threads = useAgentStore((state) => state.threads);
  const threadId = useAgentStore((state) => state.threadId);
  const loadThreads = useAgentStore((state) => state.loadThreads);
  const startNewThread = useAgentStore((state) => state.startNewThread);
  const selectThread = useAgentStore((state) => state.selectThread);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

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
                        <StreamingResponse
                          status={streaming ? "streaming" : "complete"}
                          copyText={message.body}
                          // Errors are diagnostics, not answers: no copy or
                          // feedback actions.
                          showActions={!running && !message.error}
                        >
                          {message.body}
                        </StreamingResponse>
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
              <PromptInput
                minRows={1}
                maxRows={6}
                loading={running}
                placeholder={copy.askAgent}
                aria-label={copy.askAgent}
                onSubmit={(prompt) => run(prompt, buildWorkspaceContext())}
              />
            </div>
          </>
        )}
      </AnimatedSidebar>
    </AnimatedSidebarProvider>
  );
}
