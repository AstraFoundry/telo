import path from "node:path";

import { app, BrowserWindow, Menu, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { createContainer } from "./container";
import { channels } from "./channels";
import { registerIpc } from "./register-ipc";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f7f8fa",
    title: "Telo",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (current && url !== current) event.preventDefault();
  });

  // Chromium gives renderer windows no native editing context menu, so build
  // one from standard edit roles (labels follow the system locale).
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const template: MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      template.push(
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { type: "separator" },
        { role: "selectAll" },
      );
    } else if (params.selectionText) {
      template.push({ role: "copy" });
    }
    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup({
        window: mainWindow ?? undefined,
      });
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  const container = createContainer((state) => {
    mainWindow?.webContents.send(channels.telegramAuthEvent, state);
  });
  registerIpc(container);
  createWindow();
  void container.telegram.initialize();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
