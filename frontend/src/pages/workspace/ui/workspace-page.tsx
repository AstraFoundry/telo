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
import { Button, WindowControls } from "shared/ui";

import { useNarrowWorkspace } from "../model/layout";
import { ColumnResizeHandle } from "./column-resize-handle";
import { WorkspaceSidePanel } from "./workspace-side-panel";

interface WorkspacePageProps {
  children: ReactNode;
  onOpenSettings(): void;
  /** Settings opened straight onto the Agent pane, for the panel's own CTA. */
  onOpenAgentSettings(): void;
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
  onOpenAgentSettings,
  onSelectChat,
  showBackToChats,
}: WorkspacePageProps) {
  const agentOpen = useAgentStore((state) => state.open);
  const openAgentPanel = useAgentStore((state) => state.openPanel);
  const closeAgentPanel = useAgentStore((state) => state.close);
  const profileOpen = useChatProfileStore((state) => state.open);
  const closeProfilePanel = useChatProfileStore((state) => state.closePanel);
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
      <div className="grid h-screen grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden bg-background">
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
            className="relative grid min-h-0 min-w-0 overflow-hidden bg-card"
          >
            {/* The back control overlays the conversation header's leading
                avatar spot; the layout owns it because conversation-view
                internals must stay untouched. */}
            {showBackToChats ? (
              <div className="absolute top-2 left-2 z-30 flex items-center gap-0.5">
                <WindowControls />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={copy.backToChats}
                  className="size-10 bg-card [app-region:no-drag]"
                  onClick={() => setChatListVisible(true)}
                >
                  <ArrowLeft />
                </Button>
              </div>
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
      className="grid h-screen grid-cols-[var(--workspace-sidebar-width,280px)_minmax(360px,1fr)_auto] grid-rows-[minmax(0,1fr)] overflow-hidden bg-background"
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
      <div
        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        style={{ "--window-overlay-end": "0px" } as CSSProperties}
      >
        <ConversationSidebar
          onOpenSettings={onOpenSettings}
          onSelectChat={onSelectChat}
        />
      </div>
      {/* The grid wrapper relays the stretch constraints to the surface's own
          <main> so the skip-link anchor never changes the layout. It is also
          the floating central column: the card shadow carries the separation
          from the shell background, so inner surfaces stay borderless. Both
          side corners round when a right panel is open; when closed the
          right edge stays flush with the viewport. */}
      <div
        id="main"
        className={cn(
          "grid min-h-0 min-w-0 overflow-hidden rounded-l-2xl bg-card shadow-column",
          (agentOpen || profileOpen) && "rounded-r-2xl",
        )}
        style={
          agentOpen || profileOpen
            ? ({ "--window-overlay-end": "0px" } as CSSProperties)
            : undefined
        }
      >
        {children}
      </div>
      {/* One persistent shell owns the right column's motion. Content can
          switch without replacing the animated element, so every panel gets
          the same enter and exit behavior. */}
      <WorkspaceSidePanel
        activeId={profileOpen ? "profile" : agentOpen ? "agent" : null}
        items={[
          {
            id: "agent",
            ariaLabel: copy.agent,
            content: <GlobalAgentPanel onOpenSettings={onOpenAgentSettings} />,
          },
          {
            id: "profile",
            ariaLabel: copy.chatProfile,
            content: <ChatProfilePanel />,
          },
        ]}
        onOpen={openAgentPanel}
        onClose={profileOpen ? closeProfilePanel : closeAgentPanel}
      />
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
      {/* One handle for the whole right column: both panels read the same
          width, so dragging resizes whichever one is currently in the slot —
          the way Telegram Desktop lets you drag its info column. */}
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
