import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

test("renders folder tabs with unread badges", async ({ window }) => {
  await waitForDemoWorkspace(window);

  const tabs = window.getByRole("tablist", { name: "Chat folders" });
  await expect(tabs.getByRole("tab", { name: /^All/ })).toBeVisible();

  // The Work folder holds Telo Design (3 unread) and Product Notes (0).
  const work = tabs.getByRole("tab", { name: /Work/ });
  await expect(work).toBeVisible();
  await expect(work.getByLabel("3 unread")).toBeVisible();

  // The Archive is not a tab: it is the pinned row at the top of the All
  // list, and the folder badge sits on it in the muted grey.
  const archive = window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Archived Chats/ });
  await expect(archive).toBeVisible();
  await expect(archive.getByText("2")).toBeVisible();
  await expect(tabs.getByRole("tab", { name: /Archive/ })).toHaveCount(0);
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

test("the Archive directory shows the archived chat", async ({ window }) => {
  await waitForDemoWorkspace(window);

  const chats = window.getByRole("navigation", { name: "Chats" });
  await expect(
    chats.getByRole("button", { name: /Offsite Planning/ }),
  ).toHaveCount(0);

  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Archived Chats/ })
    .click();

  await expect(
    chats.getByRole("button", { name: /Offsite Planning/ }),
  ).toBeVisible();
  await expect(chats.getByRole("button", { name: /Telo Design/ })).toHaveCount(
    0,
  );
});

test("a keyword folder lists chats whose bodies match the search term", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  const tabs = window.getByRole("tablist", { name: "Chat folders" });
  const spacing = tabs.getByRole("tab", { name: /Spacing/ });
  await expect(spacing).toBeVisible();
  await expect(spacing.getByLabel("3 unread")).toBeVisible();

  await spacing.click();

  const chats = window.getByRole("navigation", { name: "Chats" });
  await expect(
    chats.getByRole("button", { name: /Telo Design/ }),
  ).toBeVisible();
  await expect(
    chats.getByRole("button", { name: /Saved Messages/ }),
  ).toHaveCount(0);
  await expect(
    chats.getByRole("button", { name: /Product Notes/ }),
  ).toHaveCount(0);
});
