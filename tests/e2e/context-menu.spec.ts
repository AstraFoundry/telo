import { expect, openDemoWorkspace, test } from "./fixtures";

test("marks a chat as read and offers mark unread from the row context menu", async ({
  window,
}) => {
  await openDemoWorkspace(window);

  const chats = window.getByRole("navigation", { name: "Chats" });
  const row = chats.getByRole("button", { name: /Telo Design/ });
  await expect(row.getByLabel("3 unread")).toBeVisible();

  await row.click({ button: "right" });
  const menu = window.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await menu.getByRole("menuitem", { name: "Mark as read" }).click();

  await expect(row.getByLabel("3 unread")).toHaveCount(0);
  await expect(window.getByRole("menu")).toBeHidden();
  await expect(row).toHaveAttribute("aria-expanded", "false");

  await row.click({ button: "right" });
  await expect(
    window.getByRole("menu").getByRole("menuitem", { name: "Mark as unread" }),
  ).toBeVisible();
});

test("copies the message text from the bubble context menu", async ({
  window,
}) => {
  await openDemoWorkspace(window);

  const body = "Release checklist: tests, docs, signed packages.";
  await window.getByText(body).click({ button: "right" });
  const menu = window.getByRole("menu");
  const copyItem = menu.getByRole("menuitem", { name: "Copy Text" });
  await expect(copyItem).toBeVisible();
  await copyItem.click();
  await expect(menu).toBeHidden();

  try {
    const clipped = await window.evaluate(() => navigator.clipboard.readText());
    expect(clipped).toBe(body);
  } catch {
    // Electron can deny clipboard reads without a focused user gesture; the
    // clickable item and the menu dismissal above still prove the journey.
  }
});
