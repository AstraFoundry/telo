import {
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { useTelegramStore } from "../../../entities/telegram";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

import { OnboardingPage } from "./onboarding-page";

describe("OnboardingPage", () => {
  beforeAll(() => {
    // jsdom does not implement matchMedia, which motion's useReducedMotion needs.
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
    // jsdom does not implement ResizeObserver, which beui primitives use to
    // re-measure their surfaces.
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
    // jsdom does not implement IntersectionObserver, which beui's TextReveal
    // uses for its viewport trigger.
    window.IntersectionObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    } as unknown as typeof IntersectionObserver;
  });

  beforeEach(() => {
    installTeloApiMock();
    useTelegramStore.setState({
      auth: null,
      configuration: null,
      currentUser: null,
    });
  });

  it("renders the welcome step with the sign-in action only", async () => {
    render(<OnboardingPage />);

    // TextReveal splits the copy into per-word spans, so match on the
    // element's textContent rather than the computed accessible name.
    expect(screen.getByRole("heading").textContent).toBe(copy.signInToTelegram);
    expect(screen.getByRole("paragraph").textContent).toBe(
      copy.signInWithPhone,
    );
    expect(
      screen.getByRole("button", { name: copy.startMessaging }),
    ).toBeTruthy();
    // Demo workspace is a process launch flag, not an onboarding action.
    expect(
      screen.queryByRole("button", { name: /demo workspace/i }),
    ).toBeNull();
    // The connection flow stays behind the welcome step until the CTA.
    expect(screen.queryByLabelText(copy.phoneNumber)).toBeNull();
  });

  it("swaps to the phone step in place from the primary action", async () => {
    const user = userEvent.setup();
    render(<OnboardingPage />);

    await user.click(screen.getByRole("button", { name: copy.startMessaging }));

    expect(screen.getByLabelText(copy.phoneNumber)).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.continue })).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.back })).toBeTruthy();
  });

  it("returns to the welcome step from the phone step back button", async () => {
    const user = userEvent.setup();
    render(<OnboardingPage />);

    await user.click(screen.getByRole("button", { name: copy.startMessaging }));
    await user.click(screen.getByRole("button", { name: copy.back }));

    expect(
      screen.getByRole("button", { name: copy.startMessaging }),
    ).toBeTruthy();
    // The exiting step stays mounted while AnimatePresence plays its exit.
    await waitForElementToBeRemoved(() =>
      screen.queryByLabelText(copy.phoneNumber),
    );
  });

  it("keeps Start Messaging on the welcome step instead of a connecting gate", () => {
    render(<OnboardingPage />);

    expect(
      screen.getByRole("button", { name: copy.startMessaging }),
    ).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers a skip-to-content link that targets the main surface", async () => {
    const user = userEvent.setup();
    render(<OnboardingPage />);

    const link = screen.getByRole("link", { name: copy.skipToContent });
    // Visually hidden until focused.
    expect(link.className).toContain("sr-only");
    expect(link.className).toContain("focus:not-sr-only");
    // First tab stop of the page.
    (document.activeElement as HTMLElement | null)?.blur();
    await user.tab();
    expect(document.activeElement).toBe(link);
    // The anchor resolves to the <main> around the welcome step.
    expect(link.getAttribute("href")).toBe("#main");
    const target = document.getElementById("main");
    expect(target).not.toBeNull();
    expect(target?.tagName).toBe("MAIN");
    expect(target?.textContent).toContain(copy.signInToTelegram);
  });
});
