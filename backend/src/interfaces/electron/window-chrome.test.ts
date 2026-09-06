import { describe, expect, it } from "vitest";

import { windowChromeOptions } from "./window-chrome";

describe("windowChromeOptions", () => {
  it("keeps macOS traffic lights and exposes their safe area", () => {
    expect(windowChromeOptions("darwin")).toEqual({
      titleBarStyle: "hiddenInset",
      titleBarOverlay: true,
      autoHideMenuBar: true,
    });
  });

  it.each(["win32", "linux"] satisfies NodeJS.Platform[])(
    "hides the native title bar on %s and overlays window controls",
    (platform) => {
      expect(windowChromeOptions(platform)).toEqual({
        titleBarStyle: "hidden",
        titleBarOverlay: { height: 56 },
        autoHideMenuBar: true,
      });
    },
  );
});
