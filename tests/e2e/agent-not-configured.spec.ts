import {
  demoTest as test,
  expect,
  waitForDemoWorkspace,
  connectDemoAgentAccount,
} from "./fixtures";

test("blocks the composer until an account is connected and links to Settings", async ({
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
  await expect(
    window.getByRole("button", { name: "Connect account" }),
  ).toBeVisible();
});

test("streams the deterministic demo agent response into the panel", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await connectDemoAgentAccount(window);

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
