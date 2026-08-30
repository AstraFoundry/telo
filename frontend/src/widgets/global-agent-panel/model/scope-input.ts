import type {
  AgentContextScope,
  AgentContextScopeInput,
} from "../../../../../contracts/src/ipc";

export interface ScopeSelection {
  readonly scope: AgentContextScope;
  readonly activeChatId: string | null;
  readonly activeFolderId: number | null;
  /** Message the composer currently replies to; backs the `selected` scope. */
  readonly selectedMessageId: string | null;
}

/**
 * Multi-select does not exist yet (it lands with the Wave 4 batch actions),
 * so `selected` means the composer's reply target. With no reply target the
 * scope falls back to the picker default in the UI; this function is the
 * single place that maps a selection to the IPC payload.
 */
export function effectiveScope(selection: ScopeSelection): AgentContextScope {
  return selection.scope === "selected" && !selection.selectedMessageId
    ? "unread"
    : selection.scope;
}

export function buildScopeInput(
  selection: ScopeSelection,
): AgentContextScopeInput {
  const scope = effectiveScope(selection);
  if (scope === "selected") {
    // effectiveScope only keeps "selected" when a reply target exists.
    if (!selection.activeChatId || !selection.selectedMessageId) {
      throw new Error('Agent scope "selected" requires a reply target.');
    }
    return {
      scope,
      chatId: selection.activeChatId,
      messageIds: [selection.selectedMessageId],
    };
  }
  if (scope === "folder") {
    return { scope, folderId: selection.activeFolderId };
  }
  // No open chat: the panel shows an empty preview instead of asking the
  // main process to reject a known-unservable unread scope.
  return {
    scope,
    ...(selection.activeChatId ? { chatId: selection.activeChatId } : {}),
  };
}
