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

  it("hides the native title bar on win32 and overlays window controls", () => {
    expect(windowChromeOptions("win32")).toEqual({
      titleBarStyle: "hidden",
      titleBarOverlay: { height: 56 },
      autoHideMenuBar: true,
    });
  });

  it("uses a frameless window on linux because GTK keeps a native title bar", () => {
    expect(windowChromeOptions("linux")).toEqual({
      frame: false,
      autoHideMenuBar: true,
    });
  });
});
