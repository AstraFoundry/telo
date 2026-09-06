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
    "keeps the native title bar on %s without Chromium's menu bar",
    (platform) => {
      expect(windowChromeOptions(platform)).toEqual({
        titleBarStyle: "default",
        autoHideMenuBar: true,
      });
    },
  );
});
