import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { loadEnv } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "");
  const telegramApiId =
    mode === "e2e"
      ? ""
      : process.env.TELO_TELEGRAM_API_ID || env.TELO_TELEGRAM_API_ID || "";
  const telegramApiHash =
    mode === "e2e"
      ? ""
      : process.env.TELO_TELEGRAM_API_HASH || env.TELO_TELEGRAM_API_HASH || "";
  const googleOAuthClientId =
    mode === "e2e"
      ? ""
      : process.env.TELO_GOOGLE_OAUTH_CLIENT_ID ||
        env.TELO_GOOGLE_OAUTH_CLIENT_ID ||
        "";

  return {
    main: {
      define: {
        "process.env.TELO_TELEGRAM_API_ID": JSON.stringify(telegramApiId),
        "process.env.TELO_TELEGRAM_API_HASH": JSON.stringify(telegramApiHash),
        "process.env.TELO_GOOGLE_OAUTH_CLIENT_ID":
          JSON.stringify(googleOAuthClientId),
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
            index: path.join(
              root,
              "backend/src/interfaces/electron/preload.ts",
            ),
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
  };
});
