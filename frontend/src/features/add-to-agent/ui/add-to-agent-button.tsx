import { Sparkle } from "@phosphor-icons/react";

import { useAgentStore } from "entities/agent";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { Button } from "shared/ui";

import { toAttachedMessages } from "../model/attach-selected";

/**
 * Batch action for the transcript's selection mode: the selected messages
 * become cards in the agent composer, the panel opens, and selection ends —
 * the same hand-off as forwarding, except the destination is the agent.
 */
export function AddToAgentButton() {
  const attachMessages = useAgentStore((state) => state.attachMessages);
  const openPanel = useAgentStore((state) => state.openPanel);
  const disabled = useAgentStore((state) => state.running);

  const addSelected = () => {
    const chat = useChatStore.getState();
    const active = chat.chats.find((item) => item.id === chat.activeChatId);
    if (!active) return;
    const items = toAttachedMessages(
      active,
      chat.messages,
      chat.selectedMessageIds,
    );
    if (items.length === 0) return;
    attachMessages(items);
    openPanel();
    chat.exitSelection();
  };

  return (
    <Button
      variant="ghost"
      className="h-10 gap-1.5 px-3"
      disabled={disabled}
      onClick={addSelected}
    >
      <Sparkle aria-hidden="true" className="size-4" />
      {copy.agentAddToAgent}
    </Button>
  );
}
