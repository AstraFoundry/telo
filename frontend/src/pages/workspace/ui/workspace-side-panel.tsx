import { useState, type CSSProperties, type ReactNode } from "react";

import { RIGHT_PANEL_WIDTH_CSS } from "entities/preferences";
import { AnimatedSidebar, AnimatedSidebarProvider } from "shared/ui";

export interface WorkspaceSidePanelItem {
  readonly id: string;
  readonly ariaLabel: string;
  readonly content: ReactNode;
}

interface WorkspaceSidePanelProps {
  readonly activeId: string | null;
  readonly items: ReadonlyArray<WorkspaceSidePanelItem>;
  onOpen(): void;
  onClose(): void;
}

/**
 * The workspace owns one persistent animated column and swaps panel content
 * inside it. Keeping the shell mounted is what lets every panel play both its
 * entrance and exit instead of appearing expanded or disappearing on unmount.
 */
export function WorkspaceSidePanel({
  activeId,
  items,
  onOpen,
  onClose,
}: WorkspaceSidePanelProps) {
  const fallbackId = items[0]?.id ?? null;
  const [lastActiveId, setLastActiveId] = useState(activeId ?? fallbackId);
  if (activeId !== null && activeId !== lastActiveId) {
    setLastActiveId(activeId);
  }

  const open = activeId !== null;
  const visibleId = activeId ?? lastActiveId;
  const visibleItem = items.find((item) => item.id === visibleId) ?? items[0];
  const changeOpen = (nextOpen: boolean) => {
    if (nextOpen === open) return;
    if (nextOpen) onOpen();
    else onClose();
  };

  return (
    <AnimatedSidebarProvider
      open={open}
      openMobile={open}
      onOpenChange={changeOpen}
      onOpenMobileChange={changeOpen}
      style={
        {
          "--sidebar-width": RIGHT_PANEL_WIDTH_CSS,
          // This column can touch the trailing window edge, but never the
          // leading traffic-light edge. Its surfaces use the shared two-sided
          // title-bar contract and inherit this local boundary.
          "--window-overlay-start": "0px",
        } as CSSProperties
      }
    >
      <AnimatedSidebar
        side="right"
        collapsible="offcanvas"
        ariaLabel={visibleItem?.ariaLabel}
        aria-hidden={!open}
        inert={!open}
        className="overflow-hidden"
        // The panel sits directly on the shell background like the left
        // sidebar; the central card's shadow carries the separation.
        panelClassName="border-l-0 bg-transparent"
      >
        {items.map((item) => (
          <div
            key={item.id}
            hidden={item.id !== visibleId}
            className="h-full min-h-0 w-full"
          >
            {item.content}
          </div>
        ))}
      </AnimatedSidebar>
    </AnimatedSidebarProvider>
  );
}
