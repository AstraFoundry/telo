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

test("streams the deterministic demo agent response into the panel", async ({
  window,
}) => {
  // The demo workspace answers through the deterministic demo gateway, so the
  // run needs a stored key to unblock the composer but never hits a provider.
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
  await expect(conversation).toContainText(
    "Demo agent response: Summarize the visible chats.",
  );
});
