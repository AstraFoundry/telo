import type { BrowserWindowConstructorOptions } from "electron";

type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  "titleBarStyle" | "titleBarOverlay" | "autoHideMenuBar"
>;

/**
 * Keeps native window controls on every platform while allowing the macOS
 * workspace to extend into the title bar. The overlay exposes Chromium's
 * titlebar-area-* CSS environment variables so the renderer can avoid the
 * traffic lights without relying on hardcoded coordinates.
 *
 * Chromium's File/Edit/View application menu is not product chrome. Callers
 * also hide it with `Menu.setApplicationMenu(null)`.
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

  return { titleBarStyle: "default", autoHideMenuBar: true };
}
