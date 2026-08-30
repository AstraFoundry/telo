import { useRef, useState, type CSSProperties, type ReactNode } from "react";

import { ArrowLeft } from "@phosphor-icons/react";

import { ConversationSidebar } from "widgets/conversation-sidebar";
import { ChatProfilePanel } from "widgets/chat-profile";
import { GlobalAgentPanel } from "widgets/global-agent-panel";
import { useAgentStore } from "entities/agent";
import { useChatProfileStore, useChatStore } from "entities/chat";
import {
  AGENT_PANEL_WIDTH_DEFAULT,
  AGENT_PANEL_WIDTH_MAX,
  AGENT_PANEL_WIDTH_MIN,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useAgentPanelWidth,
  useSidebarWidth,
} from "entities/preferences";
import { copy } from "shared/config/copy";
import { cn } from "shared/lib/cn";
import { Button } from "shared/ui";

import { useNarrowWorkspace } from "../model/layout";
import { ColumnResizeHandle } from "./column-resize-handle";

interface WorkspacePageProps {
  children: ReactNode;
  onOpenSettings(): void;
  onSelectChat(): void;
  /**
   * Narrow layout only: whether the back-to-chats control overlays the
   * content column. The app shell turns it off on surfaces that carry their
   * own back navigation (Settings).
   */
  showBackToChats: boolean;
}

/**
 * The workspace shell. Wide viewports get three resizable columns — chat
 * list, conversation, agent panel — whose widths persist as preferences and
 * are exposed to the grid through the --workspace-sidebar-width and
 * --workspace-agent-panel-width custom properties. At or below the narrow
 * breakpoint the shell collapses to a single column that swaps between the
 * chat list and the conversation; the agent panel hides there because no
 * column is left for it.
 */
export function WorkspacePage({
  children,
  onOpenSettings,
  onSelectChat,
  showBackToChats,
}: WorkspacePageProps) {
  const agentOpen = useAgentStore((state) => state.open);
  const profileOpen = useChatProfileStore((state) => state.open);
  const activeChatId = useChatStore((state) => state.activeChatId);
  const narrow = useNarrowWorkspace();
  const { value: sidebarWidth, select: selectSidebarWidth } = useSidebarWidth();
  const { value: agentPanelWidth, select: selectAgentPanelWidth } =
    useAgentPanelWidth();
  const containerRef = useRef<HTMLDivElement>(null);
  // Narrow layout: whether the chat list covers the conversation. Resets on
  // every breakpoint crossing so a wide→narrow switch opens on the active
  // conversation, matching the mobile list↔detail convention.
  const [chatListVisible, setChatListVisible] = useState(false);
  const [wasNarrow, setWasNarrow] = useState(narrow);
  if (wasNarrow !== narrow) {
    setWasNarrow(narrow);
    if (!narrow) setChatListVisible(false);
  }

  if (narrow) {
    const showChatList = chatListVisible || !activeChatId;
    return (
      <div className="grid h-screen grid-cols-1 overflow-hidden bg-background">
        <a
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-popover focus:px-3 focus:py-2 focus:text-sm"
          href="#main"
        >
          {copy.skipToContent}
        </a>
        {showChatList ? (
          <ConversationSidebar
            onOpenSettings={onOpenSettings}
            onSelectChat={() => {
              setChatListVisible(false);
              onSelectChat();
            }}
          />
        ) : (
          <div
            id="main"
            className="relative grid min-w-0 overflow-hidden bg-card"
          >
            {/* The back control overlays the conversation header's leading
                avatar spot; the layout owns it because conversation-view
                internals must stay untouched. */}
            {showBackToChats ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label={copy.backToChats}
                className="absolute top-2 left-2 z-30 size-10 bg-card [app-region:no-drag]"
                onClick={() => setChatListVisible(true)}
              >
                <ArrowLeft />
              </Button>
            ) : null}
            {/* The narrow shell has no right column, so the chat profile
                replaces the conversation instead (list↔detail convention). */}
            {profileOpen ? <ChatProfilePanel /> : children}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="grid h-screen grid-cols-[var(--workspace-sidebar-width,280px)_minmax(360px,1fr)_auto] overflow-hidden bg-background"
      style={
        {
          "--workspace-sidebar-width": `${sidebarWidth}px`,
          "--workspace-agent-panel-width": `${agentPanelWidth}px`,
        } as CSSProperties
      }
    >
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
          side corners round when a right panel is open; when closed the
          right edge stays flush with the viewport. */}
      <div
        id="main"
        className={cn(
          "grid min-w-0 overflow-hidden rounded-l-2xl bg-card shadow-column",
          (agentOpen || profileOpen) && "rounded-r-2xl",
        )}
      >
        {children}
      </div>
      {/* The right column hosts one panel at a time; the mutual exclusion
          lives in the chat-profile widget's store subscriptions. */}
      {profileOpen ? (
        <ChatProfilePanel />
      ) : (
        <GlobalAgentPanel onOpenSettings={onOpenSettings} />
      )}
      <ColumnResizeHandle
        label={copy.resizeChatList}
        value={sidebarWidth}
        min={SIDEBAR_WIDTH_MIN}
        max={SIDEBAR_WIDTH_MAX}
        edge="leading"
        style={{
          left: `var(--workspace-sidebar-width, ${SIDEBAR_WIDTH_DEFAULT}px)`,
        }}
        onPreview={(width) =>
          containerRef.current?.style.setProperty(
            "--workspace-sidebar-width",
            `${width}px`,
          )
        }
        onCommit={selectSidebarWidth}
        onReset={() => selectSidebarWidth(SIDEBAR_WIDTH_DEFAULT)}
      />
      {agentOpen || profileOpen ? (
        <ColumnResizeHandle
          label={copy.resizeAgentPanel}
          value={agentPanelWidth}
          min={AGENT_PANEL_WIDTH_MIN}
          max={AGENT_PANEL_WIDTH_MAX}
          edge="trailing"
          style={{
            right: `var(--workspace-agent-panel-width, ${AGENT_PANEL_WIDTH_DEFAULT}px)`,
          }}
          onPreview={(width) =>
            containerRef.current?.style.setProperty(
              "--workspace-agent-panel-width",
              `${width}px`,
            )
          }
          onCommit={selectAgentPanelWidth}
          onReset={() => selectAgentPanelWidth(AGENT_PANEL_WIDTH_DEFAULT)}
        />
      ) : null}
    </div>
  );
}
