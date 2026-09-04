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
  const openaiOAuthClientId =
    mode === "e2e"
      ? ""
      : process.env.TELO_OPENAI_OAUTH_CLIENT_ID ||
        env.TELO_OPENAI_OAUTH_CLIENT_ID ||
        "";
  const anthropicOAuthClientId =
    mode === "e2e"
      ? ""
      : process.env.TELO_ANTHROPIC_OAUTH_CLIENT_ID ||
        env.TELO_ANTHROPIC_OAUTH_CLIENT_ID ||
        "";
  const xaiOAuthClientId =
    mode === "e2e"
      ? ""
      : process.env.TELO_XAI_OAUTH_CLIENT_ID ||
        env.TELO_XAI_OAUTH_CLIENT_ID ||
        "";
  const kimiOAuthClientId =
    mode === "e2e"
      ? ""
      : process.env.TELO_KIMI_OAUTH_CLIENT_ID ||
        env.TELO_KIMI_OAUTH_CLIENT_ID ||
        "";

  return {
    main: {
      define: {
        "process.env.TELO_TELEGRAM_API_ID": JSON.stringify(telegramApiId),
        "process.env.TELO_TELEGRAM_API_HASH": JSON.stringify(telegramApiHash),
        "process.env.TELO_GOOGLE_OAUTH_CLIENT_ID":
          JSON.stringify(googleOAuthClientId),
        "process.env.TELO_OPENAI_OAUTH_CLIENT_ID":
          JSON.stringify(openaiOAuthClientId),
        "process.env.TELO_ANTHROPIC_OAUTH_CLIENT_ID": JSON.stringify(
          anthropicOAuthClientId,
        ),
        "process.env.TELO_XAI_OAUTH_CLIENT_ID":
          JSON.stringify(xaiOAuthClientId),
        "process.env.TELO_KIMI_OAUTH_CLIENT_ID":
          JSON.stringify(kimiOAuthClientId),
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
        alias: [
          { find: "@", replacement: path.join(root, "frontend/src") },
          { find: "app", replacement: path.join(root, "frontend/src/app") },
          {
            find: "pages",
            replacement: path.join(root, "frontend/src/pages"),
          },
          {
            find: "widgets",
            replacement: path.join(root, "frontend/src/widgets"),
          },
          {
            find: "features",
            replacement: path.join(root, "frontend/src/features"),
          },
          {
            // Keep the FSD alias from capturing the npm `entities` package
            // used by parse5 (for example `entities/escape`).
            find: /^entities\/(agent|chat|preferences|telegram)(\/.*)?$/,
            replacement: path.join(root, "frontend/src/entities/$1$2"),
          },
          {
            find: "shared",
            replacement: path.join(root, "frontend/src/shared"),
          },
          {
            find: "@components",
            replacement: path.join(root, "frontend/src/shared/beui/components"),
          },
          {
            find: "@beui-lib",
            replacement: path.join(root, "frontend/src/shared/beui/lib"),
          },
        ],
      },
      plugins: [react(), tailwindcss()],
    },
  };
});
