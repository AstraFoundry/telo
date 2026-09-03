import path from "node:path";

import { app, BrowserWindow, Menu, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { createContainer } from "./container";
import { channels } from "./channels";
import { isSafeExternalUrl } from "./external-url";
import { registerIpc } from "./register-ipc";
import { DEMO_MESSAGE_TEMPLATES } from "../../domain/preferences/user-preferences";
import {
  handleMediaProtocol,
  registerMediaScheme,
  unhandleMediaProtocol,
} from "./media-protocol";

registerMediaScheme();

let mainWindow: BrowserWindow | null = null;

// Workspace and auth events can race window teardown (e.g. a repository
// timer firing mid-quit). After the window is destroyed there is no
// receiver, so drop the event instead of throwing "Object has been
// destroyed" in the main process, which would block app quit.
function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    // Below the workspace's narrow breakpoint (768px) the layout collapses to
    // a single column, so the window must be allowed to shrink into it.
    minWidth: 420,
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
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
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

app.whenReady().then(async () => {
  const container = createContainer((state) => {
    sendToRenderer(channels.telegramAuthEvent, state);
  });
  // The handler is safe under Playwright too: the quit-race that once hung
  // E2E teardown is fixed by the destroyed-window guard in sendToRenderer,
  // and before-quit still unhandles the scheme. The root resolves per
  // request because the active account owns the served cache directory.
  handleMediaProtocol(() => container.telegram.activeMediaCacheDirectory());
  container.workspace.subscribe((event) => {
    sendToRenderer(channels.workspaceEvent, event);
  });
  // Demo workspace is a process launch flag, not an in-app opt-in. Sync the
  // persisted preference on every start so a leftover true cannot reopen demo
  // after a plain `make dev` / packaged launch. Empty templates get the two
  // demo replies so the composer picker has something to insert.
  const demoWorkspace = process.env.TELO_DEMO_WORKSPACE === "1";
  const current = await container.preferences.get();
  await container.preferences.execute({
    demoWorkspace,
    ...(demoWorkspace && current.messageTemplates.length === 0
      ? { messageTemplates: [...DEMO_MESSAGE_TEMPLATES] }
      : {}),
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

app.on("before-quit", unhandleMediaProtocol);
