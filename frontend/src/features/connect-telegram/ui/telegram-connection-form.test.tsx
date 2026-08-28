import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { useTelegramStore } from "../../../entities/telegram";
import { copy } from "../../../shared/config/copy";
import { installTeloApiMock } from "../../../shared/test/mock-telo";

import { TelegramConnectionForm } from "./telegram-connection-form";

describe("TelegramConnectionForm", () => {
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

  it("shows a configuration alert instead of the form when the build lacks credentials", () => {
    useTelegramStore.setState({
      configuration: { applicationCredentialsConfigured: false },
    });
    render(<TelegramConnectionForm />);

    expect(screen.getByRole("alert").textContent).toBe(copy.credentialsMissing);
    expect(screen.queryByLabelText(copy.phoneNumber)).toBeNull();
  });

  it("submits the phone step without application credentials", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    render(<TelegramConnectionForm />);

    await user.type(screen.getByLabelText(copy.phoneNumber), "+15555550100");
    await user.click(screen.getByRole("button", { name: copy.continue }));

    expect(telo.telegram.beginLogin).toHaveBeenCalledWith({
      phoneNumber: "+15555550100",
    });
  });

  it("moves to the code step and back via the edit-phone action", async () => {
    const user = userEvent.setup();
    render(<TelegramConnectionForm />);

    await user.type(screen.getByLabelText(copy.phoneNumber), "+15555550100");
    act(() => {
      useTelegramStore.setState({ auth: { status: "code-required" } });
    });

    // The code step header carries the entered phone number and a way back.
    expect(screen.getByLabelText(copy.loginCode)).toBeTruthy();
    expect(screen.getByText("+15555550100")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: copy.editPhoneNumber }),
    );
    expect(screen.getByLabelText(copy.phoneNumber)).toBeTruthy();
    expect(screen.queryByLabelText(copy.loginCode)).toBeNull();
  });

  it("shows the password step when the backend asks for a password", () => {
    render(<TelegramConnectionForm />);
    act(() => {
      useTelegramStore.setState({
        auth: { status: "password-required", hint: null },
      });
    });

    expect(screen.getByText(copy.connectionPassword)).toBeTruthy();
    expect(screen.getByLabelText(copy.password)).toBeTruthy();
  });

  it("surfaces a rejected submission inline on the current step", () => {
    render(<TelegramConnectionForm />);
    act(() => {
      useTelegramStore.setState({
        auth: { status: "error", message: "Invalid phone" },
      });
    });

    expect(screen.getByRole("alert").textContent).toBe("Invalid phone");
    expect(screen.getByLabelText(copy.phoneNumber)).toBeTruthy();
  });
});
