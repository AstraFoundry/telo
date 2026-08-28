import type { ReactNode } from "react";

import { ConversationSidebar } from "widgets/conversation-sidebar";
import { GlobalAgentPanel } from "widgets/global-agent-panel";
import { useAgentStore } from "entities/agent";
import { copy } from "shared/config/copy";
import { cn } from "shared/lib/cn";

interface WorkspacePageProps {
  children: ReactNode;
  onOpenSettings(): void;
  onSelectChat(): void;
}

export function WorkspacePage({
  children,
  onOpenSettings,
  onSelectChat,
}: WorkspacePageProps) {
  const agentOpen = useAgentStore((state) => state.open);

  return (
    <div className="grid h-screen grid-cols-[280px_minmax(360px,1fr)_auto] overflow-hidden bg-background">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-popover focus:px-3 focus:py-2 focus:text-sm"
        href="#main"
      >
        {copy.skipToContent}
      </a>
      <ConversationSidebar
        onOpenSettings={onOpenSettings}
        onSelectChat={onSelectChat}
      />
      {/* The grid wrapper relays the stretch constraints to the surface's own
          <main> so the skip-link anchor never changes the layout. It is also
          the floating central column: the card shadow carries the separation
          from the shell background, so inner surfaces stay borderless. Both
          side corners round when the agent panel is open; when closed the
          right edge stays flush with the viewport. */}
      <div
        id="main"
        className={cn(
          "grid min-w-0 overflow-hidden rounded-l-2xl bg-card shadow-column",
          agentOpen && "rounded-r-2xl",
        )}
      >
        {children}
      </div>
      <GlobalAgentPanel onOpenSettings={onOpenSettings} />
    </div>
  );
}
