import { describe, expect, it } from "vitest";

import { isSafeExternalUrl } from "./external-url";

describe("isSafeExternalUrl", () => {
  it.each([
    "https://example.com/path",
    "http://example.com/path",
    "mailto:hello@example.com",
    "tel:+12025550123",
  ])("allows an intentional OS protocol: %s", (url) => {
    expect(isSafeExternalUrl(url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///tmp/private",
    "tg://resolve?domain=example",
    "not a url",
  ])("rejects an unsafe or unsupported protocol: %s", (url) => {
    expect(isSafeExternalUrl(url)).toBe(false);
  });
});
