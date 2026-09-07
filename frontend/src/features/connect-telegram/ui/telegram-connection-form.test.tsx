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

  it("preselects the country from the system locale", () => {
    render(<TelegramConnectionForm />);

    // jsdom reports en-US, so the picker starts on the United States and the
    // phone field carries the "+1" prefix.
    const picker = screen.getByLabelText(
      copy.countryOrRegion,
    ) as HTMLInputElement;
    expect(picker.value).toBe("United States");
    // The option rows carry dialing codes too; the prefix is the text-base span.
    expect(screen.getByText("+1", { selector: ".text-base" })).toBeTruthy();
  });

  it("submits the national number with the selected country's dialing code", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    render(<TelegramConnectionForm />);

    await user.type(screen.getByLabelText(copy.phoneNumber), "5555550100");
    await user.click(screen.getByRole("button", { name: copy.continue }));

    expect(telo.telegram.beginLogin).toHaveBeenCalledWith({
      phoneNumber: "+15555550100",
    });
  });

  it("selecting a country changes the dialing code", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    render(<TelegramConnectionForm />);

    await user.click(screen.getByLabelText(copy.countryOrRegion));
    await user.type(
      screen.getByLabelText(copy.countryOrRegion),
      "united kingdom",
    );
    const option = screen.getByRole("option", { name: /United Kingdom/ });
    expect(option.textContent).toContain("🇬🇧");
    await user.click(option);

    const picker = screen.getByLabelText(
      copy.countryOrRegion,
    ) as HTMLInputElement;
    expect(picker.value).toBe("United Kingdom");
    expect(screen.getByText("+44", { selector: ".text-base" })).toBeTruthy();

    await user.type(screen.getByLabelText(copy.phoneNumber), "7700900123");
    await user.click(screen.getByRole("button", { name: copy.continue }));

    expect(telo.telegram.beginLogin).toHaveBeenCalledWith({
      phoneNumber: "+447700900123",
    });
  });

  it("detects the country from a pasted international number", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    render(<TelegramConnectionForm />);

    const phoneField = screen.getByLabelText(
      copy.phoneNumber,
    ) as HTMLInputElement;
    await user.type(phoneField, "+79161234567");

    // The country picker switched to Russia and the field keeps the national
    // remainder only.
    const picker = screen.getByLabelText(
      copy.countryOrRegion,
    ) as HTMLInputElement;
    expect(picker.value).toBe("Russia");
    expect(phoneField.value).toBe("9161234567");

    await user.click(screen.getByRole("button", { name: copy.continue }));

    expect(telo.telegram.beginLogin).toHaveBeenCalledWith({
      phoneNumber: "+79161234567",
    });
  });

  it("moves to the code step and back via the edit-phone action", async () => {
    const user = userEvent.setup();
    render(<TelegramConnectionForm />);

    await user.type(screen.getByLabelText(copy.phoneNumber), "5555550100");
    act(() => {
      useTelegramStore.setState({ auth: { status: "code-required" } });
    });

    // The code step header carries the full entered number and a way back.
    expect(screen.getByLabelText(copy.loginCode)).toBeTruthy();
    expect(screen.getByText("+15555550100")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: copy.editPhoneNumber }),
    );
    expect(screen.getByLabelText(copy.phoneNumber)).toBeTruthy();
    expect(screen.queryByLabelText(copy.loginCode)).toBeNull();
  });

  it("submits the code once every slot is filled", async () => {
    const user = userEvent.setup();
    const telo = installTeloApiMock();
    render(<TelegramConnectionForm />);
    act(() => {
      useTelegramStore.setState({ auth: { status: "code-required" } });
    });

    await user.type(screen.getByLabelText(copy.loginCode), "12345");

    expect(telo.telegram.submitChallenge).toHaveBeenCalledWith("12345");
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

  it("does not mention TDLib or the client kernel on the phone step", () => {
    render(<TelegramConnectionForm />);

    expect(screen.queryByText(/TDLib/i)).toBeNull();
    expect(screen.queryByText(/Teleproto/i)).toBeNull();
    expect(screen.queryByText(/GramJS/i)).toBeNull();
  });
});
