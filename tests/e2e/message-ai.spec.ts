import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

const MESSAGE_BODY = "Release checklist: tests, docs, signed packages.";
const COMPOSER_LABEL = "Write a message…";

test("Translate streams the demo translation into the composer draft", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  await window.getByText(MESSAGE_BODY).click({ button: "right" });
  const menu = window.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Translate" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Translate" }).click();

  // The result lands in the composer, not the agent panel; the panel stays
  // closed and untouched.
  const composer = window.getByLabel(COMPOSER_LABEL);
  await expect(composer).toHaveValue(`Demo translation: ${MESSAGE_BODY}`);
  await expect(
    window.getByRole("heading", { name: "Agent" }),
  ).not.toBeVisible();
});

test("Draft reply inserts an editable suggestion with the chosen tone", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  await window.getByText(MESSAGE_BODY).click({ button: "right" });
  const menu = window.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Friendly" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Friendly" }).click();

  const composer = window.getByLabel(COMPOSER_LABEL);
  await expect(composer).toHaveValue(`Demo friendly reply: ${MESSAGE_BODY}`);

  // The suggestion is a draft: the user edits it like any typed text before
  // deciding to send.
  await composer.fill("On it — packages go out Friday.");
  await expect(composer).toHaveValue("On it — packages go out Friday.");
});

test("Rewrite replaces the composer draft with the demo rewrite", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  const composer = window.getByLabel(COMPOSER_LABEL);
  await composer.fill("typed earlier");

  await window.getByText(MESSAGE_BODY).click({ button: "right" });
  await window
    .getByRole("menu")
    .getByRole("menuitem", { name: "Rewrite" })
    .click();

  await expect(composer).toHaveValue(`Demo rewrite: ${MESSAGE_BODY}`);
});
