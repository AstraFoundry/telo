import { EventType, type AGUIEvent } from "@ag-ui/core";
import { create } from "zustand";

import type {
  AgentConfigurationDto,
  AgentThreadDto,
  AgentThreadSummaryDto,
  SaveAgentConfigurationInput,
  UiContextSnapshot,
} from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";

export interface AgentMessage {
  readonly id: string;
  readonly from: "user" | "assistant";
  readonly body: string;
  /** Set when the body reports a failed run rather than a model reply. */
  readonly error?: boolean;
}

interface AgentState {
  open: boolean;
  running: boolean;
  activity: string | null;
  messages: ReadonlyArray<AgentMessage>;
  threads: ReadonlyArray<AgentThreadSummaryDto>;
  threadId: string | null;
  configuration: AgentConfigurationDto | null;
  notificationsEnabled: boolean;
  loadPanelState(): Promise<void>;
  toggle(): void;
  close(): void;
  loadConfiguration(): Promise<void>;
  saveConfiguration(input: SaveAgentConfigurationInput): Promise<void>;
  loadThreads(): Promise<void>;
  startNewThread(): Promise<void>;
  selectThread(threadId: string): Promise<void>;
  run(prompt: string, context: UiContextSnapshot): Promise<void>;
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

  return {
    open: false,
    running: false,
    activity: null,
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
    close: () => setPanelOpen(false),
    async loadConfiguration() {
      set({ configuration: await window.telo.agent.getConfiguration() });
    },
    async saveConfiguration(input) {
      set({ configuration: await window.telo.agent.saveConfiguration(input) });
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
        threads: [toSummary(thread), ...state.threads],
      }));
    },
    async selectThread(threadId) {
      if (threadId === get().threadId) return;
      const thread = await window.telo.agent.selectThread(threadId);
      set({ threadId: thread.threadId, messages: toMessages(thread) });
    },
    async run(prompt, context) {
      // The first-ever run has no thread yet; create it so the transcript is
      // persisted under a stable id from the start.
      let threadId = get().threadId;
      if (!threadId) {
        const thread = await window.telo.agent.createThread();
        threadId = thread.threadId;
        set((state) => ({
          threadId,
          threads: [toSummary(thread), ...state.threads],
        }));
      }
      const id = crypto.randomUUID();
      set((state) => ({
        running: true,
        activity: null,
        messages: [...state.messages, { id, from: "user", body: prompt }],
      }));
      await window.telo.agent.run({ threadId, prompt, context });
      await refreshThreads();
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
      } else if (event.type === EventType.RUN_FINISHED) {
        set({ running: false, activity: null });
        notifyRunComplete(get().notificationsEnabled);
      } else if (event.type === EventType.RUN_ERROR) {
        set((state) => ({
          running: false,
          activity: null,
          messages: [
            ...state.messages,
            {
              id: crypto.randomUUID(),
              from: "assistant",
              body: event.message,
              error: true,
            },
          ],
        }));
        notifyRunComplete(get().notificationsEnabled);
      }
    },
  };
});

export function subscribeToAgentEvents(): () => void {
  return window.telo.agent.onEvent((event) =>
    useAgentStore.getState().accept(event),
  );
}
