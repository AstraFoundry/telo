import type { BrowserWindowConstructorOptions } from "electron";

type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  "titleBarStyle" | "titleBarOverlay" | "autoHideMenuBar"
>;

/**
 * Keeps native window controls on every platform while letting the workspace
 * occupy the title-bar band. Chromium's File/Edit/View application menu is
 * not product chrome; callers also hide it with `Menu.setApplicationMenu(null)`
 * and `BrowserWindow.setMenu(null)`.
 *
 * macOS uses `hiddenInset` so the traffic lights sit in the content. Windows
 * and Linux use a hidden title bar plus Window Controls Overlay so the OS
 * close/min/max buttons sit in the same 56px header band instead of a second
 * system bar above the workspace.
 */
export function windowChromeOptions(
  platform: NodeJS.Platform,
): WindowChromeOptions {
  if (platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      titleBarOverlay: true,
      autoHideMenuBar: true,
    };
  }

  return {
    titleBarStyle: "hidden",
    titleBarOverlay: { height: 56 },
    autoHideMenuBar: true,
  };
}
