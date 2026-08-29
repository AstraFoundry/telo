import { expect, test } from "./fixtures";

test("blocks the sign-in flow when the build is missing Telegram application credentials", async ({
  window,
}) => {
  await expect(
    window.getByRole("heading", { name: "Sign in to Telegram" }),
  ).toBeVisible();

  // Credentials are injected at build time; the e2e build ships none, so the
  // multi-step flow cannot reach the phone step and renders the terminal alert
  // instead.
  await window.getByRole("button", { name: "Start Messaging" }).click();

  await expect(window.getByRole("alert")).toHaveText(
    "This build is missing Telegram application credentials.",
  );
  await expect(window.getByLabel("Phone number")).not.toBeVisible();
});
