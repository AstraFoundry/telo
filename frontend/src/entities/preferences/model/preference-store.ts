import { useSyncExternalStore } from "react";

import type {
  UpdateUserPreferencesInput,
  UserPreferencesDto,
} from "../../../../../contracts/src/ipc";

type PreferenceKey = keyof UpdateUserPreferencesInput &
  keyof UserPreferencesDto;

interface PreferenceStoreOptions<V> {
  readonly defaultValue: V;
  /**
   * Side effect that makes the value visible outside React (DOM token
   * overrides). Runs on every publish, including optimistic ones.
   */
  readonly apply?: (value: V) => void;
}

/**
 * The theme model generalized to any preference key: a module-level external
 * store that loads the persisted value once, publishes optimistic writes
 * immediately, and re-sources from the persisted preferences when a write
 * fails.
 */
export function createPreferenceStore<K extends PreferenceKey>(
  key: K,
  options: PreferenceStoreOptions<UserPreferencesDto[K]>,
) {
  type Value = UserPreferencesDto[K];

  let current: Value = options.defaultValue;
  const listeners = new Set<() => void>();
  let loadPromise: Promise<void> | null = null;

  function publish(next: Value): void {
    current = next;
    options.apply?.(next);
    listeners.forEach((listener) => listener());
  }

  function load(): Promise<void> {
    loadPromise ??= window.telo.preferences
      .get()
      .then((preferences) => publish(preferences[key]));
    return loadPromise;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    void load();
    return () => {
      listeners.delete(listener);
    };
  }

  function select(next: Value): void {
    publish(next);
    window.telo.preferences
      .update({ [key]: next } as UpdateUserPreferencesInput)
      .catch(() => {
        // The write failed; fall back to the persisted value.
        void window.telo.preferences
          .get()
          .then((preferences) => publish(preferences[key]));
      });
  }

  function usePreference() {
    const value = useSyncExternalStore(subscribe, () => current);
    return { value, select } as const;
  }

  return { usePreference, load };
}
