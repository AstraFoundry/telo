import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Some Node runners expose a partial jsdom localStorage when their
// --localstorage-file flag has no path. Install a complete in-memory Storage
// before any preference module performs its module-level bootstrap.
if (typeof window.localStorage?.getItem !== "function") {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
}

// Ensures rendered components from @testing-library/react are unmounted
// between tests. Pure store tests are unaffected.
afterEach(() => {
  cleanup();
});
