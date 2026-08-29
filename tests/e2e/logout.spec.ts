import { demoTest, expect, waitForDemoWorkspace } from "./fixtures";

demoTest(
  "logs out of the demo workspace through the two-step confirm",
  async ({ window }) => {
    await waitForDemoWorkspace(window);

    await window.getByRole("button", { name: "Open account menu" }).click();
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      window.getByRole("heading", { name: "Telegram account" }),
    ).toBeVisible();

    // First click only arms the confirm state; the second click executes.
    await window.getByRole("button", { name: "Log out" }).click();
    const confirm = window.getByRole("button", { name: "Confirm log out" });
    await expect(confirm).toBeVisible();
    await confirm.click();

    // Leaving the demo workspace clears the demo preference and returns the
    // shell to onboarding. Demo is a launch flag, so the onboarding surface
    // has no demo-workspace action.
    await expect(
      window.getByRole("heading", { name: "Sign in to Telegram" }),
    ).toBeVisible();
    await expect(
      window.getByRole("button", { name: "Start Messaging" }),
    ).toBeVisible();
    await expect(
      window.getByRole("button", { name: /demo workspace/i }),
    ).not.toBeVisible();
  },
);
