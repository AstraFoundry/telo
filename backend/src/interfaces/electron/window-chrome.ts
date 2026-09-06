import type { BrowserWindowConstructorOptions } from "electron";

type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  "titleBarStyle" | "titleBarOverlay" | "autoHideMenuBar" | "frame"
>;

/**
 * Keeps native window controls on every platform while letting the workspace
 * occupy the title-bar band. Chromium's File/Edit/View application menu is
 * not product chrome; callers also hide it with `Menu.setApplicationMenu(null)`
 * and `BrowserWindow.setMenu(null)`.
 *
 * macOS uses `hiddenInset` so the traffic lights sit in the content. Windows
 * uses a hidden title bar plus Window Controls Overlay. Linux GTK ignores
 * `titleBarStyle: "hidden"` and would keep a native "Telo" bar, so the window
 * is frameless and the renderer paints close/min/max.
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

  if (platform === "win32") {
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: { height: 56 },
      autoHideMenuBar: true,
    };
  }

  return { frame: false, autoHideMenuBar: true };
}
