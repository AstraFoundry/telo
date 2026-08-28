import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useTelegramStore } from "../../../entities/telegram";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

import { TelegramConnectionFlow } from "./telegram-connection-flow";

describe("TelegramConnectionFlow", () => {
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
  });

  beforeEach(() => {
    installTeloApiMock();
    useTelegramStore.setState({
      auth: null,
      configuration: { applicationCredentialsConfigured: true },
      currentUser: null,
    });
  });

  it("renders nothing while closed", () => {
    render(<TelegramConnectionFlow open={false} onClose={vi.fn()} />);

    expect(screen.queryByLabelText(copy.phoneNumber)).toBeNull();
  });

  it("opens on the phone step and closes from the backdrop", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TelegramConnectionFlow open onClose={onClose} />);

    expect(screen.getByLabelText(copy.phoneNumber)).toBeTruthy();

    // The vendored MorphingModal ships a hardcoded backdrop label.
    await user.click(screen.getByRole("button", { name: "Close modal" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("switches the modal view when the backend asks for a code", () => {
    render(<TelegramConnectionFlow open onClose={vi.fn()} />);
    act(() => {
      useTelegramStore.setState({ auth: { status: "code-required" } });
    });

    expect(screen.getByLabelText(copy.loginCode)).toBeTruthy();
  });
});
