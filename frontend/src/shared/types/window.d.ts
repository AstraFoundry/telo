import type { TeloDesktopApi } from "../../../../contracts/src/ipc";

declare global {
  interface Window {
    telo: TeloDesktopApi;
  }
}

export {};
