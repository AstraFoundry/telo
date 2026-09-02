import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

/** Avatar menu -> Settings, the entry point a reader actually uses. */
async function openSettings(
  window: Parameters<typeof waitForDemoWorkspace>[0],
) {
  await window.getByRole("button", { name: "Open account menu" }).click();
  await window.getByRole("button", { name: "Settings", exact: true }).click();
}

test("persists Agent settings across Settings visits", async ({ window }) => {
  await waitForDemoWorkspace(window);
  await openSettings(window);

  await window.getByRole("button", { name: "Agent settings" }).click();
  await expect(
    window.getByRole("heading", { name: "Agent settings" }),
  ).toBeVisible();

  // The form backfills asynchronously once the stored configuration loads;
  // wait for the default instructions before typing into the fields.
  await expect(window.getByLabel("Instructions")).toHaveValue(
    "Answer from the visible Telegram workspace. Ask before acting outside it.",
  );
  await window.getByLabel("Model").fill("gpt-4.1-e2e");
  await window
    .getByLabel("Instructions")
    .fill("E2E persistence check instructions.");
  await window.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    window.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();

  await window.getByRole("button", { name: "Back to conversation" }).click();
  await openSettings(window);
  await window.getByRole("button", { name: "Agent settings" }).click();

  // The form remounts with defaults and backfills again; the persisted
  // values must win once the stored configuration loads.
  await expect(window.getByLabel("Model")).toHaveValue("gpt-4.1-e2e");
  await expect(window.getByLabel("Instructions")).toHaveValue(
    "E2E persistence check instructions.",
  );
});

test("scrolls a settings pane that overflows the window", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await openSettings(window);
  await window.getByRole("button", { name: "Agent settings" }).click();
  await expect(window.getByLabel("Instructions")).toBeVisible();

  // The shell clips this surface, so the pane has to own a real scrollport.
  // Without one the bottom of a long section is simply unreachable.
  const pane = window.locator("main .overflow-y-auto");
  const metrics = await pane.evaluate((el) => ({
    client: el.clientHeight,
    scroll: el.scrollHeight,
  }));
  expect(metrics.scroll).toBeGreaterThan(metrics.client);

  await pane.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  expect(await pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(
    window.getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();
});

test("navigates settings sections from the rail", async ({ window }) => {
  await waitForDemoWorkspace(window);
  await openSettings(window);

  // Account is the landing pane, matching how Telegram opens its settings.
  await expect(
    window.getByRole("heading", { level: 2, name: "Account" }),
  ).toBeVisible();

  for (const section of [
    "Appearance",
    "Chat settings",
    "Notifications",
    "Data and storage",
  ]) {
    await window.getByRole("button", { name: section, exact: true }).click();
    await expect(
      window.getByRole("heading", { level: 2, name: section }),
    ).toBeVisible();
  }
});

test("finds a setting by an alias the label does not contain", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await openSettings(window);

  await window.getByLabel("Search settings").fill("dark");
  // "dark" is nowhere in the word "Theme"; the alias index is what makes the
  // search answer the question a reader actually asks.
  await window.getByRole("button", { name: /Theme/ }).click();

  await expect(
    window.getByRole("heading", { level: 2, name: "Appearance" }),
  ).toBeVisible();
  await expect(window.getByText("Reduce motion")).toBeVisible();
});

test("turns a preference into behaviour in the running app", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await openSettings(window);
  await window.getByRole("button", { name: "Appearance", exact: true }).click();

  const before = await window
    .getByRole("slider", { name: "Message text size" })
    .getAttribute("aria-valuenow");
  await window.getByRole("slider", { name: "Message text size" }).focus();
  await window.keyboard.press("ArrowRight");

  // The preference is not a stored number for its own sake: the transcript
  // reads it through a CSS variable on the document.
  await expect
    .poll(async () =>
      window.evaluate(() =>
        document.documentElement.style.getPropertyValue("--message-text-size"),
      ),
    )
    .toBe(`${Number(before) + 1}px`);
});
