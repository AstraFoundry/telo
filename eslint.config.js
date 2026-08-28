import eslint from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules",
      "out",
      "release",
      "coverage",
      "reports",
      ".agents",
      ".workspace",
      "frontend/src/shared/beui",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["frontend/src/**/*.{ts,tsx}"],
    plugins: { boundaries, "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // UI primitives and animations must come from the shared/ui barrel.
      // Direct imports from the vendored beui registry (via the @components/*
      // or @beui-lib/* aliases, or any relative path into shared/beui) bypass
      // the public API and are forbidden. The barrel itself is exempted by the
      // override block below; the beui directory is excluded via `ignores`.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@components/*", "@beui-lib/*", "**/beui/**"],
              message:
                "Import UI primitives and animations from the shared/ui barrel instead of the vendored beui registry.",
            },
          ],
        },
      ],
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            {
              from: { element: { type: "app" } },
              allow: {
                to: {
                  element: {
                    type: [
                      // The app layer is the composition root and has no
                      // slices; it may wire its own modules (e.g. styles).
                      "app",
                      "pages",
                      "widgets",
                      "features",
                      "entities",
                      "shared",
                    ],
                  },
                },
              },
            },
            {
              from: { element: { type: "pages" } },
              allow: {
                to: {
                  element: {
                    type: ["widgets", "features", "entities", "shared"],
                  },
                },
              },
            },
            {
              from: { element: { type: "widgets" } },
              allow: {
                to: { element: { type: ["features", "entities", "shared"] } },
              },
            },
            {
              from: { element: { type: "features" } },
              allow: { to: { element: { type: ["entities", "shared"] } } },
            },
            {
              from: { element: { type: "entities" } },
              allow: { to: { element: { type: "shared" } } },
            },
            {
              from: { element: { type: "shared" } },
              allow: { to: { element: { type: "shared" } } },
            },
          ],
        },
      ],
    },
    settings: {
      // eslint-plugin-boundaries resolves imports through eslint-module-utils,
      // which reads eslint-plugin-import resolver settings. The TypeScript
      // resolver makes tsconfig path aliases (pages/*, widgets/*, ...) and
      // relative .ts/.tsx imports resolvable so the boundaries rules fire.
      "import/resolver": {
        typescript: { project: "./tsconfig.json" },
      },
      "boundaries/elements": [
        // Slice-level elements: each slice is a distinct element so that
        // same-layer cross-slice imports are not treated as internal and are
        // checked against the layer policies.
        {
          type: "app",
          pattern: "frontend/src/app/*",
          capture: ["elementName"],
        },
        { type: "app", pattern: "frontend/src/app" },
        {
          type: "pages",
          pattern: "frontend/src/pages/*",
          capture: ["elementName"],
        },
        {
          type: "widgets",
          pattern: "frontend/src/widgets/*",
          capture: ["elementName"],
        },
        {
          type: "features",
          pattern: "frontend/src/features/*",
          capture: ["elementName"],
        },
        {
          type: "entities",
          pattern: "frontend/src/entities/*",
          capture: ["elementName"],
        },
        {
          type: "shared",
          pattern: "frontend/src/shared/*",
          capture: ["elementName"],
        },
      ],
    },
  },
  {
    // The shared/ui barrel is the single module allowed to re-export from the
    // vendored beui registry; every other module must import from the barrel.
    files: ["frontend/src/shared/ui/index.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
