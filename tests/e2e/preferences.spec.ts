import { expect, openDemoWorkspace, test } from "./fixtures";

async function openSettings(window: import("@playwright/test").Page) {
  await window.getByRole("button", { name: "Open account menu" }).click();
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    window.getByRole("heading", { name: "Agent settings" }),
  ).toBeVisible();
}

test("persists appearance, messages, and notifications preferences across Settings visits", async ({
  window,
}) => {
  await openDemoWorkspace(window);
  await openSettings(window);

  const appearance = window.getByRole("region", { name: "Appearance" });

  // Theme select: the trigger is the only listbox button on the surface.
  const themeTrigger = appearance.locator('button[aria-haspopup="listbox"]');
  await themeTrigger.click();
  await window.getByRole("option", { name: "Dark" }).click();
  await expect(themeTrigger).toContainText("Dark");

  // Accent color radios.
  const accentGroup = window.getByRole("group", { name: "Accent color" });
  await accentGroup.getByRole("radio", { name: "Green" }).click();
  await expect(accentGroup.getByRole("radio", { name: "Green" })).toBeChecked();

  // Message text size slider: driven by keyboard — the role="slider" thumb
  // steps by one per ArrowRight, which is deterministic where a pointer drag
  // would depend on the track's pixel width. Default is 14; two steps → 16.
  const slider = window.getByRole("slider", { name: "Message text size" });
  await expect(slider).toHaveAttribute("aria-valuenow", "14");
  await slider.press("ArrowRight");
  await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "16");

  // Time format radios.
  const timeFormatGroup = window.getByRole("group", { name: "Time format" });
  await timeFormatGroup.getByRole("radio", { name: "24-hour" }).click();
  await expect(
    timeFormatGroup.getByRole("radio", { name: "24-hour" }),
  ).toBeChecked();

  // Send with Enter radios.
  const sendWithGroup = window.getByRole("group", { name: "Send with" });
  await sendWithGroup.getByRole("radio", { name: "Cmd+Enter" }).click();
  await expect(
    sendWithGroup.getByRole("radio", { name: "Cmd+Enter" }),
  ).toBeChecked();

  // Desktop notifications switch (defaults to on).
  const notificationsSwitch = window.getByRole("switch", {
    name: "Desktop notifications",
  });
  await expect(notificationsSwitch).toBeChecked();
  await notificationsSwitch.click();
  await expect(notificationsSwitch).not.toBeChecked();

  // Leave and reopen Settings; every value must come back from the
  // persisted preferences.json.
  await window.getByRole("button", { name: "Back to conversation" }).click();
  await openSettings(window);

  await expect(
    window
      .getByRole("region", { name: "Appearance" })
      .locator('button[aria-haspopup="listbox"]'),
  ).toContainText("Dark");
  await expect(
    window
      .getByRole("group", { name: "Accent color" })
      .getByRole("radio", { name: "Green" }),
  ).toBeChecked();
  await expect(
    window.getByRole("slider", { name: "Message text size" }),
  ).toHaveAttribute("aria-valuenow", "16");
  await expect(
    window
      .getByRole("group", { name: "Time format" })
      .getByRole("radio", { name: "24-hour" }),
  ).toBeChecked();
  await expect(
    window
      .getByRole("group", { name: "Send with" })
      .getByRole("radio", { name: "Cmd+Enter" }),
  ).toBeChecked();
  await expect(
    window.getByRole("switch", { name: "Desktop notifications" }),
  ).not.toBeChecked();
});

test("applies the 24h time format and Cmd+Enter sending to the conversation", async ({
  window,
}) => {
  await openDemoWorkspace(window);
  await openSettings(window);

  await window
    .getByRole("group", { name: "Time format" })
    .getByRole("radio", { name: "24-hour" })
    .click();
  await window
    .getByRole("group", { name: "Send with" })
    .getByRole("radio", { name: "Cmd+Enter" })
    .click();

  // The sidebar subscribes to the time-format preference live, so its
  // chat-row timestamps re-render without AM/PM markers while Settings is
  // still open — no remount needed.
  const chatNav = window.getByRole("navigation", { name: "Chats" });
  await expect
    .poll(async () =>
      (await chatNav.locator("time").allTextContents()).join("|"),
    )
    .toMatch(/^\d{1,2}:\d{2}(\|\d{1,2}:\d{2})*$/);

  await window.getByRole("button", { name: "Back to conversation" }).click();
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();

  // The conversation view subscribes to the same preference, so the message
  // timestamps also render without AM/PM markers.
  const conversation = window.getByRole("region", { name: "Conversation" });
  await expect(
    conversation.getByText(
      "The conversation list should stay compact at desktop widths.",
    ),
  ).toBeVisible();
  await expect
    .poll(async () =>
      (await conversation.locator("time").allTextContents()).join("|"),
    )
    .toMatch(/^\d{1,2}:\d{2}(\|\d{1,2}:\d{2})*$/);

  // With "Send with Cmd+Enter", a bare Enter inserts a newline instead of
  // sending; Cmd+Enter (Meta) submits through the composer.
  const composer = window.getByLabel("Write a message…");
  const body = "Cmd+Enter sends this one.";
  await composer.fill(body);
  await composer.press("Enter");
  await expect(composer).toHaveValue(`${body}\n`);
  await expect(conversation).not.toContainText(body);

  await composer.press("Meta+Enter");
  await expect(conversation).toContainText(body);
  await expect(composer).toHaveValue("");
});
