import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentConfigurationDto } from "../../../../../contracts/src/ipc";
import { AGENT_OAUTH_PROVIDERS } from "../../../../../contracts/src/ipc";
import { useAgentStore } from "entities/agent";
import { copy } from "shared/config/copy";
import type { TeloApiMock } from "shared/test/mock-telo";
import { installTeloApiMock } from "shared/test/mock-telo";

import { AgentConfigurationForm } from "./agent-configuration-form";

const CONFIGURATION: AgentConfigurationDto = {
  provider: "openai",
  model: "gpt-4.1-mini",
  baseUrl: null,
  instructions: "Answer from the visible workspace.",
  hasCredential: false,
  authKind: null,
  accountLabel: null,
  configuredOAuthProviders: [...AGENT_OAUTH_PROVIDERS],
  canInspectWorkspace: true,
  temperature: 0.7,
  maxSteps: 4,
  historyLimit: 20,
};

describe("AgentConfigurationForm", () => {
  let telo: TeloApiMock;

  beforeAll(() => {
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
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
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
    telo = installTeloApiMock();
    telo.agent.getConfiguration.mockResolvedValue(CONFIGURATION);
    telo.agent.saveConfiguration.mockImplementation(async (input) => ({
      ...CONFIGURATION,
      ...input,
      baseUrl: input.baseUrl ?? null,
      hasCredential: Boolean(input.apiKey) || CONFIGURATION.hasCredential,
      authKind: input.apiKey ? "api-key" : CONFIGURATION.authKind,
    }));
    telo.agent.connectAccount.mockImplementation(async (input) => ({
      ...CONFIGURATION,
      ...input,
      baseUrl: input.baseUrl ?? null,
      hasCredential: true,
      authKind: "oauth",
      accountLabel: "mina@example.com",
      provider: input.provider,
    }));
    useAgentStore.setState({ configuration: null });
  });

  async function renderForm() {
    render(<AgentConfigurationForm />);
    await waitFor(() => {
      expect(
        (screen.getByRole("combobox", { name: copy.model }) as HTMLInputElement)
          .value,
      ).toBe("gpt-4.1-mini");
    });
  }

  function modelField(): HTMLInputElement {
    return screen.getByRole("combobox", {
      name: copy.model,
    }) as HTMLInputElement;
  }

  it("hides the base URL for a named account", async () => {
    await renderForm();

    expect(screen.getByRole("combobox", { name: copy.provider })).toBeTruthy();
    expect(screen.queryByLabelText(copy.baseUrl)).toBeNull();
    expect(screen.queryByLabelText(copy.apiKey)).toBeNull();
    expect(
      screen.getByRole("button", { name: copy.connectAccount }),
    ).toBeTruthy();
  });

  it("uses the compact onboarding path with Continue followed by Skip", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const onSkip = vi.fn();
    render(
      <AgentConfigurationForm
        variant="onboarding"
        onComplete={onComplete}
        onSkip={onSkip}
      />,
    );
    await waitFor(() => {
      expect(
        (
          screen.getByRole("combobox", {
            name: copy.model,
          }) as HTMLInputElement
        ).value,
      ).toBe("gpt-4.1-mini");
    });

    expect(screen.getByRole("heading").textContent).toBe(copy.connectAiTitle);
    const continueButton = screen.getByRole("button", { name: copy.continue });
    const skipButton = screen.getByRole("button", { name: copy.skipForNow });
    expect(continueButton.hasAttribute("disabled")).toBe(true);
    expect(
      continueButton.compareDocumentPosition(skipButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(skipButton);
    expect(onSkip).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("continues from onboarding after an OAuth account is connected", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <AgentConfigurationForm
        variant="onboarding"
        onComplete={onComplete}
        onSkip={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(
        (
          screen.getByRole("combobox", {
            name: copy.model,
          }) as HTMLInputElement
        ).value,
      ).toBe("gpt-4.1-mini");
    });

    await user.click(screen.getByRole("button", { name: copy.connectAccount }));
    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: copy.continue })
          .hasAttribute("disabled"),
      ).toBe(false);
    });
    await user.click(screen.getByRole("button", { name: copy.continue }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  });

  it("fills the Anthropic default model and offers Connect instead of a key", async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.click(screen.getByRole("combobox", { name: copy.provider }));
    await user.click(screen.getByRole("option", { name: copy.anthropic }));

    expect(modelField().value).toBe("claude-sonnet-4-5");
    expect(screen.queryByLabelText(copy.baseUrl)).toBeNull();
    expect(screen.queryByLabelText(copy.apiKey)).toBeNull();
    expect(
      screen.getByRole("button", { name: copy.connectAccount }),
    ).toBeTruthy();
  });

  it("shows the base URL only for the OpenAI-compatible fallback", async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.click(screen.getByRole("combobox", { name: copy.provider }));
    await user.click(screen.getByRole("option", { name: copy.compatible }));

    expect(screen.getByLabelText(copy.baseUrl)).toBeTruthy();
    expect(screen.getByLabelText(copy.agentTemperature)).toBeTruthy();
  });

  it("hides temperature when an OpenAI-compatible model is a Kimi family id", async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.click(screen.getByRole("combobox", { name: copy.provider }));
    await user.click(screen.getByRole("option", { name: copy.compatible }));
    await user.clear(modelField());
    await user.type(modelField(), "kimi-k2.5");

    expect(screen.queryByLabelText(copy.agentTemperature)).toBeNull();
  });

  it("saves a Groq account with an API key", async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.click(screen.getByRole("combobox", { name: copy.provider }));
    await user.click(screen.getByRole("option", { name: copy.groq }));
    await user.type(screen.getByLabelText(copy.apiKey), "gsk-test");
    await user.click(screen.getByRole("button", { name: copy.save }));

    await waitFor(() => {
      expect(telo.agent.saveConfiguration).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "groq",
          model: "llama-3.3-70b-versatile",
          baseUrl: null,
          apiKey: "gsk-test",
        }),
      );
    });
  });

  it("connects a Kimi account instead of asking for a key", async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.click(screen.getByRole("combobox", { name: copy.provider }));
    await user.click(screen.getByRole("option", { name: copy.kimi }));

    expect(modelField().value).toBe("kimi-k2.5");
    expect(screen.queryByLabelText(copy.apiKey)).toBeNull();
    expect(screen.queryByLabelText(copy.agentTemperature)).toBeNull();
    await user.click(screen.getByRole("button", { name: copy.connectAccount }));

    await waitFor(() => {
      expect(telo.agent.connectAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "kimi",
          model: "kimi-k2.5",
        }),
      );
    });
  });

  it("connects a Google account instead of asking for a key", async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.click(screen.getByRole("combobox", { name: copy.provider }));
    await user.click(screen.getByRole("option", { name: copy.google }));

    expect(screen.queryByLabelText(copy.apiKey)).toBeNull();
    await user.click(screen.getByRole("button", { name: copy.connectAccount }));

    await waitFor(() => {
      expect(telo.agent.connectAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "google",
          model: "gemini-2.5-flash",
        }),
      );
    });
    expect(await screen.findByText("mina@example.com")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: new RegExp(`${copy.accountConnected}|${copy.disconnectAccount}`),
      }),
    ).toBeTruthy();
  });

  it("does not list models until a credential exists", async () => {
    await renderForm();

    expect(telo.agent.listModels).not.toHaveBeenCalled();
  });

  it("lists vendor models after Connect and keeps the current id", async () => {
    const user = userEvent.setup();
    telo.agent.listModels.mockResolvedValue({
      models: [
        { id: "claude-sonnet-4-5", label: "Sonnet 4.5" },
        { id: "claude-opus-4-1", label: "Opus 4.1" },
      ],
    });
    await renderForm();

    await user.click(screen.getByRole("combobox", { name: copy.provider }));
    await user.click(screen.getByRole("option", { name: copy.anthropic }));
    await user.click(screen.getByRole("button", { name: copy.connectAccount }));

    await waitFor(() => {
      expect(telo.agent.listModels).toHaveBeenCalledWith({
        provider: "anthropic",
        baseUrl: null,
        apiKey: undefined,
      });
    });
    await user.click(modelField());
    expect(screen.getByRole("option", { name: "Opus 4.1" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(modelField().value).toBe("Sonnet 4.5");
  });

  it("keeps the typed model when the vendor list fails", async () => {
    const user = userEvent.setup();
    telo.agent.listModels.mockRejectedValue(new Error("unauthorized"));
    await renderForm();

    await user.click(screen.getByRole("combobox", { name: copy.provider }));
    await user.click(screen.getByRole("option", { name: copy.groq }));
    await user.type(screen.getByLabelText(copy.apiKey), "gsk-test");

    await waitFor(() => {
      expect(screen.getByText(copy.modelsUnavailable)).toBeTruthy();
    });
    expect(modelField().value).toBe("llama-3.3-70b-versatile");
  });
});
