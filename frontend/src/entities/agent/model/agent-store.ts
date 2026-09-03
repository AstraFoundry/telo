import { EventType, type AGUIEvent } from "@ag-ui/core";
import { create } from "zustand";

import {
  AGENT_SUGGESTIONS_EVENT_NAME,
  type AgentConfigurationDto,
  type AgentContextScopeInput,
  type AgentSuggestionsPayload,
  type AgentThreadDto,
  type AgentThreadSummaryDto,
  type MessageDto,
  type SaveAgentConfigurationInput,
  type ConnectAgentAccountInput,
  type UiContextSnapshot,
} from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";

export interface AgentMessage {
  readonly id: string;
  readonly from: "user" | "assistant";
  readonly body: string;
  /** Set when the body reports a failed run rather than a model reply. */
  readonly error?: boolean;
}

/**
 * Unread scope of a chat-scoped action run, collected from the chat store.
 * The messages only gate the action (an empty scope disables it); the
 * payload itself is assembled main-side from the chat's unread counter.
 */
export interface ChatActionScope {
  readonly chatId: string;
  readonly chatTitle: string;
  readonly messages: ReadonlyArray<
    Pick<MessageDto, "id" | "senderName" | "body">
  >;
}

export type ChatActionKind = "summary" | "extraction";

/**
 * A Telegram message the user added to the conversation as context. It
 * renders as a card inside the composer; on submit the ids become the run's
 * `selected` scope and the main process re-reads and redacts the bodies.
 */
export interface AgentAttachedMessage {
  readonly chatId: string;
  readonly chatTitle: string;
  readonly messageId: string;
  readonly senderName: string;
  readonly body: string;
}

/** The inputs of the last run, kept so a failed run can be retried as-is. */
type LastRun =
  | {
      readonly kind: "prompt";
      readonly prompt: string;
      readonly context: UiContextSnapshot;
      readonly scope: AgentContextScopeInput;
    }
  | {
      readonly kind: "chat-action";
      readonly action: ChatActionKind;
      readonly scope: ChatActionScope;
      readonly context: UiContextSnapshot;
    };

interface AgentState {
  open: boolean;
  running: boolean;
  activity: string | null;
  /**
   * Set when the last run ended in `RUN_ERROR`. The panel shows a quiet
   * retry affordance instead of the failure text: provider and transport
   * diagnostics belong in the main-process log, not in a chat transcript.
   */
  runFailed: boolean;
  lastRun: LastRun | null;
  attachments: ReadonlyArray<AgentAttachedMessage>;
  /**
   * Follow-up prompts proposed for the latest reply. They arrive after
   * `RUN_FINISHED`, are offered as pills above the composer, and clear the
   * moment the next run starts or the thread changes.
   */
  suggestions: ReadonlyArray<string>;
  messages: ReadonlyArray<AgentMessage>;
  threads: ReadonlyArray<AgentThreadSummaryDto>;
  threadId: string | null;
  configuration: AgentConfigurationDto | null;
  notificationsEnabled: boolean;
  loadPanelState(): Promise<void>;
  toggle(): void;
  openPanel(): void;
  close(): void;
  loadConfiguration(): Promise<void>;
  saveConfiguration(input: SaveAgentConfigurationInput): Promise<void>;
  connectAccount(input: ConnectAgentAccountInput): Promise<void>;
  disconnectAccount(input: ConnectAgentAccountInput): Promise<void>;
  loadThreads(): Promise<void>;
  startNewThread(): Promise<void>;
  selectThread(threadId: string): Promise<void>;
  run(
    prompt: string,
    context: UiContextSnapshot,
    scope: AgentContextScopeInput,
  ): Promise<void>;
  runChatAction(
    kind: ChatActionKind,
    scope: ChatActionScope,
    context: UiContextSnapshot,
  ): Promise<void>;
  retryLastRun(): Promise<void>;
  attachMessages(items: ReadonlyArray<AgentAttachedMessage>): void;
  detachMessage(messageId: string): void;
  clearAttachments(): void;
  accept(event: AGUIEvent): void;
}

function toMessages(thread: AgentThreadDto): ReadonlyArray<AgentMessage> {
  return thread.messages.map(({ id, from, body, error }) =>
    error ? { id, from, body, error: true } : { id, from, body },
  );
}

function toSummary(thread: AgentThreadDto): AgentThreadSummaryDto {
  return {
    threadId: thread.threadId,
    title: thread.title,
    updatedAt: thread.updatedAt,
  };
}

// A finished run only notifies when the window is unfocused and the user
// opted in on the Settings surface; the flag is cached by loadPanelState.
function notifyRunComplete(enabled: boolean): void {
  if (!enabled || !document.hidden) return;
  void window.telo.shell.notify(copy.agent, copy.notifyRunCompleteBody);
}

export const useAgentStore = create<AgentState>((set, get) => {
  // Persisted preferences are the only source of truth for the panel state.
  // Toggle optimistically; on a failed write, resync from the stored value.
  const setPanelOpen = (open: boolean): void => {
    if (open === get().open) return;
    set({ open });
    window.telo.preferences.update({ agentPanelOpen: open }).catch(() => {
      void window.telo.preferences
        .get()
        .then((preferences) => set({ open: preferences.agentPanelOpen }));
    });
  };

  // A run changes the thread's title and updatedAt, so the summary list is
  // refreshed from the main process once the run resolves.
  const refreshThreads = async (): Promise<void> => {
    const list = await window.telo.agent.listThreads();
    set({ threads: list.threads });
  };

  // The first-ever run has no thread yet; create it so the transcript is
  // persisted under a stable id from the start.
  const ensureThreadId = async (): Promise<string> => {
    const existing = get().threadId;
    if (existing) return existing;
    const thread = await window.telo.agent.createThread();
    set((state) => ({
      threadId: thread.threadId,
      threads: [toSummary(thread), ...state.threads],
    }));
    return thread.threadId;
  };

  return {
    open: false,
    running: false,
    activity: null,
    runFailed: false,
    lastRun: null,
    attachments: [],
    suggestions: [],
    messages: [],
    threads: [],
    threadId: null,
    configuration: null,
    notificationsEnabled: false,
    async loadPanelState() {
      const preferences = await window.telo.preferences.get();
      set({
        open: preferences.agentPanelOpen,
        notificationsEnabled: preferences.notificationsEnabled,
      });
    },
    toggle: () => setPanelOpen(!get().open),
    openPanel: () => setPanelOpen(true),
    close: () => setPanelOpen(false),
    async loadConfiguration() {
      set({ configuration: await window.telo.agent.getConfiguration() });
    },
    async saveConfiguration(input) {
      set({ configuration: await window.telo.agent.saveConfiguration(input) });
    },
    async connectAccount(input) {
      set({ configuration: await window.telo.agent.connectAccount(input) });
    },
    async disconnectAccount(input) {
      set({ configuration: await window.telo.agent.disconnectAccount(input) });
    },
    async loadThreads() {
      const list = await window.telo.agent.listThreads();
      set({ threads: list.threads, threadId: list.activeThreadId });
      if (list.activeThreadId) {
        const thread = await window.telo.agent.getThread(list.activeThreadId);
        if (thread) set({ messages: toMessages(thread) });
      }
    },
    async startNewThread() {
      const thread = await window.telo.agent.createThread();
      set((state) => ({
        threadId: thread.threadId,
        messages: [],
        runFailed: false,
        lastRun: null,
        suggestions: [],
        threads: [toSummary(thread), ...state.threads],
      }));
    },
    async selectThread(threadId) {
      if (threadId === get().threadId) return;
      const thread = await window.telo.agent.selectThread(threadId);
      set({
        threadId: thread.threadId,
        messages: toMessages(thread),
        runFailed: false,
        lastRun: null,
        suggestions: [],
      });
    },
    async run(prompt, context, scope) {
      const threadId = await ensureThreadId();
      const id = crypto.randomUUID();
      set((state) => ({
        running: true,
        activity: null,
        runFailed: false,
        lastRun: { kind: "prompt", prompt, context, scope },
        // The cards were consumed into the run's scope; the composer starts
        // the next question clean.
        attachments: [],
        suggestions: [],
        messages: [...state.messages, { id, from: "user", body: prompt }],
      }));
      // The scope is assembled and redacted main-side; the transcript keeps
      // the bare prompt.
      await window.telo.agent.run({ threadId, prompt, context, scope });
      await refreshThreads();
    },
    async runChatAction(kind, scope, context) {
      if (get().running || scope.messages.length === 0) return;
      const threadId = await ensureThreadId();
      const promptLabel =
        kind === "summary"
          ? copy.agentSummarizeUnread
          : copy.agentExtractInsights;
      const id = crypto.randomUUID();
      set((state) => ({
        running: true,
        activity: null,
        runFailed: false,
        lastRun: { kind: "chat-action", action: kind, scope, context },
        suggestions: [],
        // The transcript shows the action label; the machine prompt with the
        // message payload is assembled main-side from the same input.
        messages: [...state.messages, { id, from: "user", body: promptLabel }],
      }));
      const input = {
        threadId,
        context,
        chatId: scope.chatId,
        chatTitle: scope.chatTitle,
        promptLabel,
      };
      if (kind === "summary") await window.telo.agent.runChatSummary(input);
      else await window.telo.agent.runChatExtraction(input);
      await refreshThreads();
    },
    async retryLastRun() {
      const last = get().lastRun;
      if (!last || get().running) return;
      // The failed attempt already left its user turn in the transcript; the
      // retry drops that turn so the question is not shown twice.
      set((state) => ({
        messages: dropTrailingUserTurn(state.messages),
      }));
      if (last.kind === "prompt") {
        await get().run(last.prompt, last.context, last.scope);
      } else {
        await get().runChatAction(last.action, last.scope, last.context);
      }
    },
    attachMessages(items) {
      const [first] = items;
      if (!first) return;
      set((state) => {
        // A `selected` scope reads one chat; cards from another chat are
        // replaced rather than mixed into a payload the run cannot send.
        const kept = state.attachments.filter(
          (item) => item.chatId === first.chatId,
        );
        const known = new Set(kept.map((item) => item.messageId));
        const added = items.filter((item) => !known.has(item.messageId));
        return { attachments: [...kept, ...added] };
      });
    },
    detachMessage(messageId) {
      set((state) => ({
        attachments: state.attachments.filter(
          (item) => item.messageId !== messageId,
        ),
      }));
    },
    clearAttachments() {
      if (get().attachments.length) set({ attachments: [] });
    },
    accept(event) {
      if (event.type === EventType.TEXT_MESSAGE_START) {
        set((state) => ({
          messages: [
            ...state.messages,
            { id: event.messageId, from: "assistant", body: "" },
          ],
        }));
      } else if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === event.messageId
              ? { ...message, body: message.body + event.delta }
              : message,
          ),
        }));
      } else if (event.type === EventType.CUSTOM && event.name === "activity") {
        const value = event.value as { label?: string };
        set({ activity: value.label ?? null });
      } else if (
        event.type === EventType.CUSTOM &&
        event.name === AGENT_SUGGESTIONS_EVENT_NAME
      ) {
        // Trails RUN_FINISHED; a run started meanwhile has already cleared
        // the slot and must not receive the previous reply's follow-ups.
        if (get().running) return;
        const value = event.value as AgentSuggestionsPayload;
        set({ suggestions: value.items });
      } else if (event.type === EventType.RUN_FINISHED) {
        set({ running: false, activity: null });
        notifyRunComplete(get().notificationsEnabled);
      } else if (event.type === EventType.RUN_ERROR) {
        // The failure text stays out of the transcript. A run that had
        // already streamed partial text keeps it; an empty shell is dropped
        // so the retry row sits directly under the question.
        set((state) => ({
          running: false,
          activity: null,
          runFailed: true,
          messages: state.messages.filter(
            (message) => !(message.from === "assistant" && !message.body),
          ),
        }));
        notifyRunComplete(get().notificationsEnabled);
      }
    },
  };
});

function dropTrailingUserTurn(
  messages: ReadonlyArray<AgentMessage>,
): ReadonlyArray<AgentMessage> {
  const last = messages[messages.length - 1];
  return last?.from === "user" ? messages.slice(0, -1) : messages;
}

export function subscribeToAgentEvents(): () => void {
  return window.telo.agent.onEvent((event) =>
    useAgentStore.getState().accept(event),
  );
}
