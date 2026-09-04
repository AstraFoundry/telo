import {
  connectDemoAgentAccount,
  demoTest as test,
  expect,
  waitForDemoWorkspace,
} from "./fixtures";

test("streams rich Markdown through the agent panel", async ({ window }) => {
  await waitForDemoWorkspace(window);
  await connectDemoAgentAccount(window);
  await window.getByRole("button", { name: "Open agent" }).click();

  const conversation = window.getByRole("region", {
    name: "Agent conversation",
  });
  await conversation.evaluate((element) => {
    const viewport = element as HTMLElement & {
      __teloScrollBehaviors?: ScrollBehavior[];
    };
    viewport.style.height = "120px";
    viewport.__teloScrollBehaviors = [];
    const scrollTo = viewport.scrollTo.bind(viewport);
    viewport.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
      if (typeof options === "object") {
        viewport.__teloScrollBehaviors?.push(options.behavior ?? "auto");
      }
      if (typeof options === "number") scrollTo(options, y ?? 0);
      else scrollTo(options);
    };
  });

  const composer = window.getByLabel("Ask about this workspace…");
  await composer.fill("Show the Markdown demo.");
  await composer.press("Enter");

  await expect(
    conversation.getByRole("heading", { level: 2, name: "Markdown preview" }),
  ).toBeVisible();
  await expect(
    conversation.locator('[data-streamdown="strong"]'),
  ).toContainText("Streaming is ready.");
  await expect(conversation.locator("ul > li")).toHaveCount(2);
  await expect(conversation.locator("blockquote")).toContainText(
    "Safe blockquote",
  );

  const copyCode = conversation.getByRole("button", { name: "Copy code" });
  const codeBlock = copyCode.locator("xpath=../..");
  await expect(codeBlock).toBeVisible();
  await expect(codeBlock).toHaveAttribute("data-state", "complete");
  await expect(codeBlock).toContainText("const ready = true;");
  await expect(
    conversation.getByRole("link", { name: "Open the documentation" }),
  ).toHaveAttribute("href", "https://example.com/docs");
  await expect(conversation.locator("[data-sd-animate]")).toHaveCount(0);

  const scroll = await conversation.evaluate((element) => {
    const viewport = element as HTMLElement & {
      __teloScrollBehaviors?: ScrollBehavior[];
    };
    return {
      behaviors: viewport.__teloScrollBehaviors ?? [],
      clientHeight: viewport.clientHeight,
      distanceFromEnd:
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight,
      scrollHeight: viewport.scrollHeight,
    };
  });
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
  expect(scroll.distanceFromEnd).toBeLessThanOrEqual(1);
  expect(scroll.behaviors).not.toContain("smooth");
});
