import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

/** Avatar menu -> Settings -> Agent, the entry point a reader actually uses. */
async function openAgentSettings(
  window: Parameters<typeof waitForDemoWorkspace>[0],
) {
  await window.getByRole("button", { name: "Open account menu" }).click();
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  await window.getByRole("button", { name: "Agent settings" }).click();
  await expect(
    window.getByRole("heading", { name: "Agent settings" }),
  ).toBeVisible();
  // The form backfills asynchronously once the stored configuration loads.
  await expect(window.getByLabel("Instructions")).toHaveValue(
    "Answer from the visible Telegram workspace. Ask before acting outside it.",
  );
}

test("connects a first-class Anthropic account and unblocks the agent", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await openAgentSettings(window);

  await expect(window.getByLabel("Base URL")).toHaveCount(0);
  await window.getByRole("combobox", { name: "Provider" }).click();
  await window.getByRole("option", { name: "Anthropic" }).click();
  await expect(window.getByLabel("Model")).toHaveValue("claude-sonnet-4-5");
  await expect(window.getByLabel("Base URL")).toHaveCount(0);

  await window.getByLabel("API key").fill("sk-ant-e2e-not-a-real-key");
  await window.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    window.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();

  await window.getByRole("button", { name: "Back to conversation" }).click();
  await window.getByRole("button", { name: "Open agent" }).click();
  await expect(window.getByLabel("Ask about this workspace…")).toBeVisible();

  await openAgentSettings(window);
  await expect(window.getByRole("combobox", { name: "Provider" })).toHaveValue(
    "Anthropic",
  );
  await expect(window.getByLabel("Model")).toHaveValue("claude-sonnet-4-5");
  await expect(window.getByLabel("Base URL")).toHaveCount(0);
});

test("configures an OpenAI-compatible endpoint as the fallback", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await openAgentSettings(window);

  await window.getByRole("combobox", { name: "Provider" }).click();
  await window.getByRole("option", { name: "OpenAI-compatible" }).click();
  await expect(window.getByLabel("Base URL")).toBeVisible();
  await window.getByLabel("Base URL").fill("https://example.invalid/v1");
  await window.getByLabel("Model").fill("local-model");
  await window.getByLabel("API key").fill("sk-e2e-compatible");
  await window.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    window.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();

  await window.getByRole("button", { name: "Back to conversation" }).click();
  await openAgentSettings(window);
  await expect(window.getByRole("combobox", { name: "Provider" })).toHaveValue(
    "OpenAI-compatible",
  );
  await expect(window.getByLabel("Base URL")).toHaveValue(
    "https://example.invalid/v1",
  );
  await expect(window.getByLabel("Model")).toHaveValue("local-model");
});

test("connects a Google account through OAuth without an API key", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await openAgentSettings(window);

  await window.getByRole("combobox", { name: "Provider" }).click();
  await window.getByRole("option", { name: "Google" }).click();
  await expect(window.getByLabel("Model")).toHaveValue("gemini-2.5-flash");
  await expect(window.getByLabel("API key")).toHaveCount(0);
  await window.getByRole("button", { name: "Connect account" }).click();
  await expect(window.getByText("e2e@example.com")).toBeVisible();
  await expect(
    window.getByRole("button", { name: "Disconnect" }),
  ).toBeVisible();

  await window.getByRole("button", { name: "Back to conversation" }).click();
  await window.getByRole("button", { name: "Open agent" }).click();
  await expect(window.getByLabel("Ask about this workspace…")).toBeVisible();
});
