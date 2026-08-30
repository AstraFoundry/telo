import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

test("switches the conversation view when a different chat is selected", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  const conversation = window.getByRole("region", { name: "Conversation" });
  const chats = window.getByRole("navigation", { name: "Chats" });

  // The demo workspace activates the first chat on entry.
  await expect(
    window.getByRole("heading", { name: "Saved Messages" }),
  ).toBeVisible();
  await expect(conversation).toContainText("Release checklist");

  await chats.getByRole("button", { name: /Telo Design/ }).click();
  await expect(
    window.getByRole("heading", { name: "Telo Design" }),
  ).toBeVisible();
  await expect(conversation).toContainText(
    "The conversation list should stay compact at desktop widths.",
  );
  await expect(
    conversation.locator("strong", { hasText: "compact" }),
  ).toBeVisible();
  await expect(conversation).not.toContainText("Release checklist");

  await chats.getByRole("button", { name: /Product Notes/ }).click();
  await expect(
    window.getByRole("heading", { name: "Product Notes" }),
  ).toBeVisible();
  await expect(conversation).toContainText(
    "Agent context is ready for review.",
  );
  await expect(conversation).not.toContainText(
    "The conversation list should stay compact at desktop widths.",
  );
});

test("filters the chat list from the search field", async ({ window }) => {
  await waitForDemoWorkspace(window);

  const chats = window.getByRole("navigation", { name: "Chats" });
  await expect(
    chats.getByRole("button", { name: /Saved Messages/ }),
  ).toBeVisible();
  await expect(
    chats.getByRole("button", { name: /Telo Design/ }),
  ).toBeVisible();
  await expect(
    chats.getByRole("button", { name: /Product Notes/ }),
  ).toBeVisible();

  await window.getByLabel("Search chats").fill("product");
  await expect(
    chats.getByRole("button", { name: /Product Notes/ }),
  ).toBeVisible();
  await expect(
    chats.getByRole("button", { name: /Telo Design/ }),
  ).not.toBeVisible();
  await expect(
    chats.getByRole("button", { name: /Saved Messages/ }),
  ).not.toBeVisible();

  await window.getByLabel("Search chats").fill("no-such-chat");
  await expect(chats.getByText("No chats found")).toBeVisible();

  await window.getByLabel("Search chats").fill("");
  await expect(
    chats.getByRole("button", { name: /Telo Design/ }),
  ).toBeVisible();
  await expect(
    chats.getByRole("button", { name: /Saved Messages/ }),
  ).toBeVisible();
});
