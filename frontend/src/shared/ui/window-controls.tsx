import { Minus, Square, X } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { Button } from "@components/motion/button";
import { copy } from "shared/config/copy";

/**
 * Close / minimize / maximize for Linux frameless windows. GTK keeps a native
 * title bar unless the BrowserWindow has `frame: false`, so these replace
 * the OS buttons. They sit in the header's document flow — never `position:
 * fixed` over the title — matching Electron's custom title-bar guidance
 * (`-webkit-app-region: no-drag` on the controls, drag on the bar).
 */
export function WindowControls() {
  if (!window.telo.shell.frameless) return null;

  return (
    <div className="flex shrink-0 items-center gap-0.5 pr-1 [app-region:no-drag]">
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
