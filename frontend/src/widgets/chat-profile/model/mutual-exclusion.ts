import { useAgentStore } from "entities/agent";
import { useChatProfileStore } from "entities/chat";

// The profile panel and the agent panel share the workspace's right column:
// opening one closes the other. Entities cannot import each other across
// slices, so the orchestration lives in the widget that depends on both.
useChatProfileStore.subscribe((state, previous) => {
  if (state.open && !previous.open) useAgentStore.getState().close();
});
useAgentStore.subscribe((state, previous) => {
  if (state.open && !previous.open) useChatProfileStore.getState().closePanel();
});
