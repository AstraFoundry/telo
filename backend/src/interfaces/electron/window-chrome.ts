import type { BrowserWindowConstructorOptions } from "electron";

type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  "titleBarStyle" | "titleBarOverlay"
>;

/**
 * Keeps native window controls on every platform while allowing the macOS
 * workspace to extend into the title bar. The overlay exposes Chromium's
 * titlebar-area-* CSS environment variables so the renderer can avoid the
 * traffic lights without relying on hardcoded coordinates.
 */
export function windowChromeOptions(
  platform: NodeJS.Platform,
): WindowChromeOptions {
  if (platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      titleBarOverlay: true,
    };
  }

  return { titleBarStyle: "default" };
}
