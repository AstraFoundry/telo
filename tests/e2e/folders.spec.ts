import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

test("renders folder tabs with unread badges", async ({ window }) => {
  await waitForDemoWorkspace(window);

  const tabs = window.getByRole("tablist", { name: "Chat folders" });
  await expect(tabs.getByRole("tab", { name: /^All/ })).toBeVisible();

  // The Work folder holds Telo Design (3 unread) and Product Notes (0).
  const work = tabs.getByRole("tab", { name: /Work/ });
  await expect(work).toBeVisible();
  await expect(work.getByLabel("3 unread")).toBeVisible();

  // The Archive holds the archived Offsite Planning chat (2 unread).
  const archive = tabs.getByRole("tab", { name: /Archive/ });
  await expect(archive).toBeVisible();
  await expect(archive.getByLabel("2 unread")).toBeVisible();
});

test("selecting a folder filters the chat list", async ({ window }) => {
  await waitForDemoWorkspace(window);

  const chats = window.getByRole("navigation", { name: "Chats" });
  // The All view shows every non-archived chat.
  await expect(
    chats.getByRole("button", { name: /Saved Messages/ }),
  ).toBeVisible();
  await expect(
    chats.getByRole("button", { name: /Telo Design/ }),
  ).toBeVisible();
  await expect(
    chats.getByRole("button", { name: /Offsite Planning/ }),
  ).toHaveCount(0);

  await window.getByRole("tab", { name: /Work/ }).click();

  await expect(
    chats.getByRole("button", { name: /Telo Design/ }),
  ).toBeVisible();
  await expect(
    chats.getByRole("button", { name: /Product Notes/ }),
  ).toBeVisible();
  await expect(
    chats.getByRole("button", { name: /Saved Messages/ }),
  ).toHaveCount(0);

  await window.getByRole("tab", { name: /^All/ }).click();

  await expect(
    chats.getByRole("button", { name: /Saved Messages/ }),
  ).toBeVisible();
});

test("the Archive tab shows the archived chat", async ({ window }) => {
  await waitForDemoWorkspace(window);

  const chats = window.getByRole("navigation", { name: "Chats" });
  await expect(
    chats.getByRole("button", { name: /Offsite Planning/ }),
  ).toHaveCount(0);

  await window.getByRole("tab", { name: /Archive/ }).click();

  await expect(
    chats.getByRole("button", { name: /Offsite Planning/ }),
  ).toBeVisible();
  await expect(chats.getByRole("button", { name: /Telo Design/ })).toHaveCount(
    0,
  );
});
