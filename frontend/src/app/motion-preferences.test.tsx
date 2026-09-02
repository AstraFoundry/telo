import { act, render } from "@testing-library/react";
import { useContext } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installTeloApiMock } from "../shared/test/mock-telo";

// Motion latches the reduced-motion query the first time any component reads
// it, so the stub has to be in place before the module graph loads. The
// device setting itself stays off here: jsdom cannot flip it per test, so the
// system-on case lives in tests/e2e/reduced-motion.spec.ts, where Playwright
// emulates it for real. What this file pins is the provider's own resolution.
function stubMatchMedia(): void {
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
}

/**
 * Renders a probe that reports what any animated surface would read, so the
 * assertions cover the hook every component actually calls rather than the
 * provider's own prop.
 */
async function renderProbe(reduceMotion: boolean) {
  vi.resetModules();
  stubMatchMedia();
  const telo = installTeloApiMock();
  const stored = await telo.preferences.get();
  telo.preferences.get.mockResolvedValue({ ...stored, reduceMotion });
  const [
    { MotionPreferences },
    { MotionConfigContext, useReducedMotionConfig },
  ] = await Promise.all([
    import("./motion-preferences"),
    import("motion/react"),
  ]);

  function Probe() {
    const { reducedMotion } = useContext(MotionConfigContext);
    return (
      <span data-slot="probe" data-setting={reducedMotion}>
        {String(useReducedMotionConfig())}
      </span>
    );
  }

  const { container } = render(
    <MotionPreferences>
      <Probe />
    </MotionPreferences>,
  );
  // The preference arrives over IPC, so the stored value lands a microtask
  // after first paint.
  await act(async () => {});
  const probe = container.querySelector<HTMLElement>('[data-slot="probe"]');
  return { reduced: probe?.textContent, setting: probe?.dataset.setting };
}

describe("MotionPreferences", () => {
  beforeEach(() => {
    stubMatchMedia();
  });

  it("forces the reduced path on for every surface when the preference is on", async () => {
    expect(await renderProbe(true)).toEqual({
      reduced: "true",
      setting: "always",
    });
  });

  it("leaves the device setting authoritative when the preference is off", async () => {
    // "user" rather than "never": the override may only ever add restraint,
    // so a reader who asked the system for less motion still gets less.
    expect(await renderProbe(false)).toEqual({
      reduced: "false",
      setting: "user",
    });
  });
});
