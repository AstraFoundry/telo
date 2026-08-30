import { useEffect, useSyncExternalStore } from "react";

import type {
  AccentColorPreference,
  UserPreferencesDto,
} from "../../../../../contracts/src/ipc";

import { createPreferenceStore } from "./preference-store";

export type ThemeChoice = UserPreferencesDto["theme"];

// Write-through cache so the boot script in index.html can paint the stored
// theme before JS. Also the one-time migration source from pre-preferences.
const THEME_CACHE_KEY = "telo:theme";

let currentChoice: ThemeChoice = "system";
const listeners = new Set<() => void>();
let themeOriginX = 50;
let themeOriginY = 50;

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

function readCachedTheme(): ThemeChoice | null {
  const stored = window.localStorage.getItem(THEME_CACHE_KEY);
  if (stored === null) return null;
  if (!isThemeChoice(stored)) {
    window.localStorage.removeItem(THEME_CACHE_KEY);
    return null;
  }
  return stored;
}

function writeCachedTheme(choice: ThemeChoice): void {
  window.localStorage.setItem(THEME_CACHE_KEY, choice);
}

export function applyThemeChoice(choice: ThemeChoice): void {
  const dark =
    choice === "dark" ||
    (choice === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  writeCachedTheme(choice);
}

function revealTheme(apply: () => void): void {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const start = document.startViewTransition?.bind(document);
  if (reduce || !start) {
    apply();
    return;
  }
  document.documentElement.style.setProperty(
    "--telo-theme-x",
    `${themeOriginX}%`,
  );
  document.documentElement.style.setProperty(
    "--telo-theme-y",
    `${themeOriginY}%`,
  );
  start(apply);
}

function publish(choice: ThemeChoice, reveal = false): void {
  currentChoice = choice;
  if (reveal) revealTheme(() => applyThemeChoice(choice));
  else applyThemeChoice(choice);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Captured before this session writes the cache so a default "system" apply
// does not look like a user-stored choice and override IPC.
let bootCache: ThemeChoice | null = null;

async function loadPersistedChoice(): Promise<ThemeChoice> {
  const preferences = await window.telo.preferences.get();
  if (bootCache && bootCache !== preferences.theme) {
    void window.telo.preferences.update({ theme: bootCache });
    return bootCache;
  }
  return preferences.theme;
}

export function useTheme() {
  const choice = useSyncExternalStore(subscribe, () => currentChoice);

  useEffect(() => {
    if (choice !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeChoice("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);

  const select = (next: ThemeChoice) => {
    publish(next, true);
    window.telo.preferences.update({ theme: next }).catch(() => {
      void window.telo.preferences
        .get()
        .then((preferences) => publish(preferences.theme));
    });
  };

  return { choice, select };
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (event) => {
      const width = window.innerWidth || 1;
      const height = window.innerHeight || 1;
      themeOriginX = (event.clientX / width) * 100;
      themeOriginY = (event.clientY / height) * 100;
    },
    { capture: true, passive: true },
  );
}

export const MESSAGE_TEXT_SIZE_MIN = 12;
export const MESSAGE_TEXT_SIZE_MAX = 18;
export const MESSAGE_TEXT_SIZE_DEFAULT = 14;

// Workspace column widths mirror the bounds the backend domain enforces in
// backend/src/domain/preferences/user-preferences.ts.
export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 480;
export const SIDEBAR_WIDTH_DEFAULT = 280;
export const AGENT_PANEL_WIDTH_MIN = 280;
export const AGENT_PANEL_WIDTH_MAX = 600;
export const AGENT_PANEL_WIDTH_DEFAULT = 380;

interface AccentTokens {
  readonly primary: string;
  readonly primaryForeground: string;
  readonly ring: string;
}

// Accent token table. Lightness and chroma mirror the blue --primary/--ring
// pair in app/styles/index.css exactly; only the hue differs per accent.
// Blue itself is the stylesheet default and needs no entry here.
const ACCENT_TOKENS: Record<
  Exclude<AccentColorPreference, "blue">,
  { light: AccentTokens; dark: AccentTokens }
> = {
  green: {
    light: {
      primary: "oklch(0.56 0.16 145)",
      primaryForeground: "oklch(0.985 0 0)",
      ring: "oklch(0.61 0.14 145)",
    },
    dark: {
      primary: "oklch(0.7 0.13 145)",
      primaryForeground: "oklch(0.15 0.02 250)",
      ring: "oklch(0.7 0.13 145)",
    },
  },
  purple: {
    light: {
      primary: "oklch(0.56 0.16 295)",
      primaryForeground: "oklch(0.985 0 0)",
      ring: "oklch(0.61 0.14 295)",
    },
    dark: {
      primary: "oklch(0.7 0.13 295)",
      primaryForeground: "oklch(0.15 0.02 250)",
      ring: "oklch(0.7 0.13 295)",
    },
  },
  red: {
    light: {
      primary: "oklch(0.56 0.16 25)",
      primaryForeground: "oklch(0.985 0 0)",
      ring: "oklch(0.61 0.14 25)",
    },
    dark: {
      primary: "oklch(0.7 0.13 25)",
      primaryForeground: "oklch(0.15 0.02 250)",
      ring: "oklch(0.7 0.13 25)",
    },
  },
  orange: {
    light: {
      primary: "oklch(0.56 0.16 60)",
      primaryForeground: "oklch(0.985 0 0)",
      ring: "oklch(0.61 0.14 60)",
    },
    dark: {
      primary: "oklch(0.7 0.13 60)",
      primaryForeground: "oklch(0.15 0.02 250)",
      ring: "oklch(0.7 0.13 60)",
    },
  },
};

const OVERRIDDEN_TOKENS = [
  "--primary",
  "--primary-foreground",
  "--ring",
] as const;

/**
 * Token override point: a non-blue accent shadows the --primary /
 * --primary-foreground / --ring custom properties from app/styles/index.css
 * with inline values on documentElement, so every semantic surface (buttons,
 * radios, focus rings, tinted bubbles) follows the accent. Blue removes the
 * inline overrides and lets the stylesheet default win again.
 */
export function applyAccentColor(accent: AccentColorPreference): void {
  const root = document.documentElement;
  if (accent === "blue") {
    OVERRIDDEN_TOKENS.forEach((token) => root.style.removeProperty(token));
    return;
  }
  const tokens =
    ACCENT_TOKENS[accent][root.classList.contains("dark") ? "dark" : "light"];
  root.style.setProperty("--primary", tokens.primary);
  root.style.setProperty("--primary-foreground", tokens.primaryForeground);
  root.style.setProperty("--ring", tokens.ring);
}

/**
 * Token override point: the conversation text size is published as a CSS
 * custom property so message surfaces size with
 * `var(--message-text-size, 14px)` and track the slider live.
 */
export function applyMessageTextSize(size: number): void {
  document.documentElement.style.setProperty(
    "--message-text-size",
    `${size}px`,
  );
}

let currentAccent: AccentColorPreference = "blue";

const accentStore = createPreferenceStore("accentColor", {
  defaultValue: "blue",
  apply: (accent) => {
    currentAccent = accent;
    applyAccentColor(accent);
  },
});

const messageTextSizeStore = createPreferenceStore("messageTextSize", {
  defaultValue: MESSAGE_TEXT_SIZE_DEFAULT,
  apply: applyMessageTextSize,
});

const timeFormatStore = createPreferenceStore("timeFormat", {
  defaultValue: "system",
});

const sendWithEnterStore = createPreferenceStore("sendWithEnter", {
  defaultValue: true,
});

const notificationsEnabledStore = createPreferenceStore(
  "notificationsEnabled",
  {
    defaultValue: true,
  },
);

const sidebarWidthStore = createPreferenceStore("sidebarWidth", {
  defaultValue: SIDEBAR_WIDTH_DEFAULT,
});

const agentPanelWidthStore = createPreferenceStore("agentPanelWidth", {
  defaultValue: AGENT_PANEL_WIDTH_DEFAULT,
});

const recentEmojisStore = createPreferenceStore("recentEmojis", {
  defaultValue: [],
});

const messageTemplatesStore = createPreferenceStore("messageTemplates", {
  defaultValue: [],
});

export const useAccentColor = accentStore.usePreference;
export const useMessageTextSize = messageTextSizeStore.usePreference;
export const useTimeFormat = timeFormatStore.usePreference;
export const useSendWithEnter = sendWithEnterStore.usePreference;
export const useNotificationsEnabled = notificationsEnabledStore.usePreference;
export const useSidebarWidth = sidebarWidthStore.usePreference;
export const useAgentPanelWidth = agentPanelWidthStore.usePreference;
export const useRecentEmojis = recentEmojisStore.usePreference;
export const useMessageTemplates = messageTemplatesStore.usePreference;

// Applied at module scope from the local cache (or system if none) so IPC
// cannot flash the wrong theme. The boot script in index.html does the same
// before first paint; this keeps React in sync if that script did not run.
bootCache = readCachedTheme();
if (bootCache) currentChoice = bootCache;
applyThemeChoice(currentChoice);
void loadPersistedChoice().then((choice) => publish(choice));

// Eager application, like the theme model: the accent and the text size are
// visible app-wide, so they load at import time instead of waiting for the
// first subscriber. The observer re-applies the accent's dark/light token
// set whenever the theme model flips the `dark` class.
new MutationObserver(() => applyAccentColor(currentAccent)).observe(
  document.documentElement,
  { attributes: true, attributeFilter: ["class"] },
);
void accentStore.load();
void messageTextSizeStore.load();
