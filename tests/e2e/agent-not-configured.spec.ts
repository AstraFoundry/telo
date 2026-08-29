import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

test("blocks the composer until an API key is configured and links to Settings", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  await window.getByRole("button", { name: "Open agent" }).click();
  await expect(window.getByRole("heading", { name: "Agent" })).toBeVisible();
  await expect(window.getByText("Connect an AI provider")).toBeVisible();
  await expect(
    window.getByLabel("Ask about this workspace…"),
  ).not.toBeVisible();

  await window.getByRole("button", { name: "Open Agent settings" }).click();
  await expect(
    window.getByRole("heading", { name: "Agent settings" }),
  ).toBeVisible();
  await expect(window.getByLabel("API key")).toBeVisible();
});

test("renders a sanitized assistant error for a rejected API key", async ({
  window,
}) => {
  // The run round-trips to the real provider with a fake key.
  test.setTimeout(60_000);
  await waitForDemoWorkspace(window);

  await window.getByRole("button", { name: "Open account menu" }).click();
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    window.getByRole("heading", { name: "Agent settings" }),
  ).toBeVisible();

  // The form backfills asynchronously once the stored configuration loads;
  // wait for the default instructions before typing into the fields.
  await expect(window.getByLabel("Instructions")).toHaveValue(
    "Answer from the visible Telegram workspace. Ask before acting outside it.",
  );
  await window.getByLabel("API key").fill("sk-telo-e2e-not-a-real-key");
  await window.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    window.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();

  await window.getByRole("button", { name: "Back to conversation" }).click();
  await window.getByRole("button", { name: "Open agent" }).click();

  const composer = window.getByLabel("Ask about this workspace…");
  await expect(composer).toBeVisible();
  await composer.fill("Summarize the visible chats.");
  await composer.press("Enter");

  const conversation = window.getByRole("region", {
    name: "Agent conversation",
  });
  await expect(conversation).toContainText("Summarize the visible chats.");
  // The provider error is classified and sanitized: a friendly message with
  // no key material and no bare endpoint URL.
  await expect(conversation).toContainText(
    "The provider rejected the API key. Check Agent settings.",
    { timeout: 30_000 },
  );
  await expect(conversation).not.toContainText("sk-telo-e2e");
  await expect(conversation).not.toContainText("platform.openai.com");
  // A failed run leaves no empty assistant shell and no feedback actions.
  await expect(conversation.getByLabel("assistant message")).toHaveCount(1);
  await expect(conversation.getByLabel("Copy response")).toHaveCount(0);
  await expect(conversation.getByLabel("Helpful")).toHaveCount(0);
});
