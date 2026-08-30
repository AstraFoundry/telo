import { installTeloApiMock } from "./mock-telo";

// The preferences slice touches matchMedia and window.telo at module scope
// (theme bootstrap), so tests that statically import preference-aware
// components need both installed before those imports evaluate. Import this
// module first in such test files; per-test mocks still install their own
// window.telo in beforeEach.

// jsdom does not implement matchMedia.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  onchange: null,
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

installTeloApiMock();
