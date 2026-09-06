import { Minus, Square, X } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { Button } from "@components/motion/button";
import { copy } from "shared/config/copy";

/**
 * Close / minimize / maximize for Linux frameless windows. GTK keeps a native
 * title bar unless the BrowserWindow has `frame: false`, so these replace
 * the OS buttons in the same 56px header band.
 */
export function WindowControls() {
  if (!window.telo.shell.frameless) return null;

  return (
    <div className="pointer-events-none fixed top-0 left-0 z-50 flex h-14 items-center pl-3">
      <div className="pointer-events-auto flex items-center gap-0.5 [app-region:no-drag]">
        <Control action="close" label={copy.windowClose}>
          <X aria-hidden="true" className="size-3.5" />
        </Control>
        <Control action="minimize" label={copy.windowMinimize}>
          <Minus aria-hidden="true" className="size-3.5" />
        </Control>
        <Control action="maximize" label={copy.windowMaximize}>
          <Square aria-hidden="true" className="size-3" />
        </Control>
      </div>
    </div>
  );
}

function Control({
  action,
  label,
  children,
}: {
  action: "minimize" | "maximize" | "close";
  label: string;
  children: ReactNode;
}) {
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={label}
      className="size-7"
      onClick={() => void window.telo.shell.windowControl(action)}
    >
      {children}
    </Button>
  );
}
