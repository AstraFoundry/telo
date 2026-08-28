import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    define: {
      "process.env.TELO_TELEGRAM_API_ID": JSON.stringify(
        process.env.TELO_TELEGRAM_API_ID ?? "",
      ),
      "process.env.TELO_TELEGRAM_API_HASH": JSON.stringify(
        process.env.TELO_TELEGRAM_API_HASH ?? "",
      ),
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: path.join(root, "backend/src/interfaces/electron/main.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: path.join(root, "backend/src/interfaces/electron/preload.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    root: path.join(root, "frontend"),
    build: {
      rollupOptions: {
        input: path.join(root, "frontend/index.html"),
      },
    },
    resolve: {
      alias: {
        "@": path.join(root, "frontend/src"),
        app: path.join(root, "frontend/src/app"),
        pages: path.join(root, "frontend/src/pages"),
        widgets: path.join(root, "frontend/src/widgets"),
        features: path.join(root, "frontend/src/features"),
        entities: path.join(root, "frontend/src/entities"),
        shared: path.join(root, "frontend/src/shared"),
        "@components": path.join(root, "frontend/src/shared/beui/components"),
        "@beui-lib": path.join(root, "frontend/src/shared/beui/lib"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
