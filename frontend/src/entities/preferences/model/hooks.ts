import { useEffect, useSyncExternalStore } from "react";

import type {
  AccentColorPreference,
  UserPreferencesDto,
} from "../../../../../contracts/src/ipc";

import { createPreferenceStore } from "./preference-store";

export type ThemeChoice = UserPreferencesDto["theme"];

// One-time migration source: the theme lived under this localStorage key
// before the preferences port owned it.
const LEGACY_STORAGE_KEY = "telo:theme";

let currentChoice: ThemeChoice = "system";
const listeners = new Set<() => void>();

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

// Reads and removes the pre-preferences localStorage value, if any.
function readLegacyThemeChoice(): ThemeChoice | null {
  const stored = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (stored === null) return null;
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  return isThemeChoice(stored) ? stored : null;
}

export function applyThemeChoice(choice: ThemeChoice): void {
  const dark =
    choice === "dark" ||
    (choice === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function publish(choice: ThemeChoice): void {
  currentChoice = choice;
  applyThemeChoice(choice);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function loadPersistedChoice(): Promise<ThemeChoice> {
  const legacy = readLegacyThemeChoice();
  const preferences = await window.telo.preferences.get();
  if (legacy && legacy !== preferences.theme) {
    void window.telo.preferences.update({ theme: legacy });
    return legacy;
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
    publish(next);
    window.telo.preferences.update({ theme: next }).catch(() => {
      void window.telo.preferences
        .get()
        .then((preferences) => publish(preferences.theme));
    });
  };

  return { choice, select };
}

export const MESSAGE_TEXT_SIZE_MIN = 12;
export const MESSAGE_TEXT_SIZE_MAX = 18;
export const MESSAGE_TEXT_SIZE_DEFAULT = 14;

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

export const useAccentColor = accentStore.usePreference;
export const useMessageTextSize = messageTextSizeStore.usePreference;
export const useTimeFormat = timeFormatStore.usePreference;
export const useSendWithEnter = sendWithEnterStore.usePreference;
export const useNotificationsEnabled = notificationsEnabledStore.usePreference;

// Applied at module scope so the system theme takes effect immediately: the
// app entry imports this slice eagerly (through the settings page and the
// conversation widgets), and IPC is asynchronous. The persisted choice
// replaces it as soon as preferences resolve, so users with a non-system
// theme may see a brief flash of the system theme at startup.
applyThemeChoice(currentChoice);
void loadPersistedChoice().then(publish);

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
