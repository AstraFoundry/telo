import type { AgentContextScopeInput } from "../../../../../contracts/src/ipc";
import type { AgentAttachedMessage } from "entities/agent";

export interface ScopeSelection {
  /** Messages the user added to the conversation as cards. */
  readonly attachments: ReadonlyArray<AgentAttachedMessage>;
  readonly activeChatId: string | null;
  readonly activeFolderId: number | null;
}

/**
 * The scope of a panel run is implicit, never picked from a control: cards
 * in the composer make the run read exactly those messages, an open chat
 * makes it read that chat's unread tail, and nothing open widens it to the
 * unread messages across the active folder. This is the single place that
 * maps the workspace state to the IPC payload.
 */
export function buildScopeInput(
  selection: ScopeSelection,
): AgentContextScopeInput {
  const [first] = selection.attachments;
  if (first) {
    return {
      scope: "selected",
      chatId: first.chatId,
      messageIds: selection.attachments.map((item) => item.messageId),
    };
  }
  if (selection.activeChatId) {
    return { scope: "unread", chatId: selection.activeChatId };
  }
  return { scope: "folder", folderId: selection.activeFolderId };
}
