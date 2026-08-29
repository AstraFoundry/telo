import path from "node:path";
import { fileURLToPath } from "node:url";

import { coverageConfigDefaults, defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "backend",
          environment: "node",
          include: ["backend/src/**/*.test.ts"],
        },
      },
      {
        resolve: {
          // Mirrors the renderer aliases from electron.vite.config.ts so
          // frontend component tests resolve FSD layer imports.
          alias: {
            "@": path.join(root, "frontend/src"),
            app: path.join(root, "frontend/src/app"),
            pages: path.join(root, "frontend/src/pages"),
            widgets: path.join(root, "frontend/src/widgets"),
            features: path.join(root, "frontend/src/features"),
            entities: path.join(root, "frontend/src/entities"),
            shared: path.join(root, "frontend/src/shared"),
            "@components": path.join(
              root,
              "frontend/src/shared/beui/components",
            ),
            "@beui-lib": path.join(root, "frontend/src/shared/beui/lib"),
          },
        },
        test: {
          name: "frontend",
          environment: "jsdom",
          include: ["frontend/src/**/*.test.{ts,tsx}"],
          setupFiles: ["frontend/src/shared/test/setup.ts"],
          // Component suites that re-import the module graph per test
          // (resetModules + dynamic import) can exceed the 5s default when
          // the whole suite runs under load; the same goes for their async
          // setup hooks against the 10s default.
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "backend/src/domain/**/*.ts",
        "backend/src/application/**/*.ts",
        "backend/src/infrastructure/telegram/demo-telegram-repository.ts",
        "backend/src/infrastructure/telegram/file-telegram-connection-profile-repository.ts",
        "backend/src/infrastructure/telegram/file-telegram-session-repository.ts",
        "backend/src/infrastructure/agent/file-agent-configuration-repository.ts",
        "backend/src/infrastructure/preferences/file-user-preferences-repository.ts",
        "frontend/src/entities/**/model/**/*.ts",
      ],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "frontend/src/shared/beui/**",
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
    },
  },
});
