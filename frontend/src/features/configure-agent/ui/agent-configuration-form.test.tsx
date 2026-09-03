import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AgentConfigurationDto } from "../../../../../contracts/src/ipc";
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
  hasApiKey: false,
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
  });

  beforeEach(() => {
    telo = installTeloApiMock();
    telo.agent.getConfiguration.mockResolvedValue(CONFIGURATION);
    telo.agent.saveConfiguration.mockImplementation(async (input) => ({
      ...CONFIGURATION,
      ...input,
      baseUrl: input.baseUrl ?? null,
      hasApiKey: Boolean(input.apiKey) || CONFIGURATION.hasApiKey,
    }));
    useAgentStore.setState({ configuration: null });
  });

  async function renderForm() {
    render(<AgentConfigurationForm />);
    await waitFor(() => {
      expect(
        (screen.getByLabelText(copy.model) as HTMLInputElement).value,
      ).toBe("gpt-4.1-mini");
    });
  }

  it("hides the base URL for a named account", async () => {
    await renderForm();

    expect(screen.getByRole("combobox", { name: copy.provider })).toBeTruthy();
    expect(screen.queryByLabelText(copy.baseUrl)).toBeNull();
  });

  it("fills the Anthropic default model and keeps the base URL hidden", async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.click(screen.getByRole("combobox", { name: copy.provider }));
    await user.click(screen.getByRole("option", { name: copy.anthropic }));

    expect((screen.getByLabelText(copy.model) as HTMLInputElement).value).toBe(
      "claude-sonnet-4-5",
    );
    expect(screen.queryByLabelText(copy.baseUrl)).toBeNull();
  });

  it("shows the base URL only for the OpenAI-compatible fallback", async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.click(screen.getByRole("combobox", { name: copy.provider }));
    await user.click(screen.getByRole("option", { name: copy.compatible }));

    expect(screen.getByLabelText(copy.baseUrl)).toBeTruthy();
  });

  it("saves an Anthropic account without a base URL", async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.click(screen.getByRole("combobox", { name: copy.provider }));
    await user.click(screen.getByRole("option", { name: copy.anthropic }));
    await user.type(screen.getByLabelText(copy.apiKey), "sk-ant-test");
    await user.click(screen.getByRole("button", { name: copy.save }));

    await waitFor(() => {
      expect(telo.agent.saveConfiguration).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          baseUrl: null,
          apiKey: "sk-ant-test",
        }),
      );
    });
  });
});
