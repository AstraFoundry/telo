import { test, _electron as electron, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { createWriteStream, writeFileSync } from "node:fs";

/**
 * Manual live-account baseline driver (docs/telegram/baseline.md). Runs only
 * with TELO_LIVE_E2E=1 against a signed-in user-data directory.
 */
const liveEnabled = process.env.TELO_LIVE_E2E === "1";

test("live baseline driver", async () => {
  test.skip(
    !liveEnabled,
    "Set TELO_LIVE_E2E=1 and provide a live user-data dir",
  );
  test.setTimeout(900_000);

  /**
   * Live baseline driver: exercises docs/telegram/baseline.md against the real
   * account. Each item reports PASS/FAIL; failures never abort later items.
   */
  const results: Array<[string, string]> = [];
  async function item(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      results.push([name, "PASS"]);
      console.log(`PASS ${name}`);
    } catch (error) {
      results.push([name, `FAIL ${String(error).slice(0, 160)}`]);
      console.log(`FAIL ${name}: ${String(error).slice(0, 300)}`);
    }
  }
  async function expectText(page: Page, text: string, timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if ((await page.locator("body").innerText()).includes(text)) return;
      await page.waitForTimeout(500);
    }
    throw new Error(`text not found: ${text}`);
  }

  const electronPath = createRequire(import.meta.url)("electron");
  const logStream = createWriteStream("/tmp/telo-live-main.log");
  const app = await electron.launch({
    executablePath: electronPath,
    args: [".", `--user-data-dir=/tmp/telo-live-userdata`],
    env: {
      ...process.env,
      TELO_PLAINTEXT_SECRETS: "1",
      TELO_DEMO_WORKSPACE: "",
    },
  });
  app.process().stdout?.pipe(logStream);
  app.process().stderr?.pipe(logStream);
  const window = await app.firstWindow();
  window.on("console", (msg) => {
    if (msg.type() === "error")
      console.log("PAGE ERROR:", msg.text().slice(0, 250));
  });
  await window
    .getByRole("button", { name: "Open account menu" })
    .waitFor({ timeout: 120000 });
  await window.waitForTimeout(3000);

  const chats = window.getByRole("navigation", { name: "Chats" });
  const convo = window.getByRole("region", { name: "Conversation" });
  const composer = () => window.getByLabel("Write a message…");

  async function openSavedMessages() {
    await window.getByRole("button", { name: "Open account menu" }).click();
    await window.waitForTimeout(1200);
    await window
      .getByRole("button", { name: "Saved Messages" })
      .first()
      .click();
    await window.waitForTimeout(3500);
  }

  const stamp = Date.now().toString(36);
  const msgA = `telo baseline ${stamp} alpha`;
  const msgAEdited = `${msgA} (edited)`;

  await item("saved-messages: open and send", async () => {
    await openSavedMessages();
    await composer().fill(msgA);
    await composer().press("Enter");
    await expectText(window, msgA);
    // Delivery gate: Reply/Edit/Forward stay hidden until the send is acked.
    await window.waitForTimeout(8000);
  });

  await item("history: edit message", async () => {
    await convo
      .getByText(msgA)
      .first()
      .click({ button: "right", position: { x: 8, y: 8 } });
    await window
      .getByRole("menu")
      .getByRole("menuitem", { name: "Edit message" })
      .click();
    await composer().fill(msgAEdited);
    await composer().press("Enter");
    await expectText(window, msgAEdited);
  });

  await item("history: reply shows quote", async () => {
    await convo
      .getByText(msgAEdited)
      .first()
      .click({ button: "right", position: { x: 8, y: 8 } });
    await window
      .getByRole("menu")
      .getByRole("menuitem", { name: "Reply" })
      .click();
    await composer().fill(`${stamp} reply`);
    await composer().press("Enter");
    await expectText(window, `${stamp} reply`);
  });

  await item("history: forward to same chat", async () => {
    await window.waitForTimeout(8000);
    await convo
      .getByText(`${stamp} reply`)
      .first()
      .click({ button: "right", position: { x: 8, y: 8 } });
    await window.waitForTimeout(800);
    await window
      .getByRole("menu")
      .getByRole("menuitem", { name: "Forward" })
      .click();
    await window.waitForTimeout(1500);
    const picker = window.getByRole("dialog");
    await picker
      .getByText(/Saved Messages/)
      .first()
      .click();
    await window.waitForTimeout(1000);
    const sendBtn = window.getByRole("button", { name: /^Forward$/ });
    if (await sendBtn.count()) await sendBtn.click();
    await window.waitForTimeout(3000);
    const count = await convo.getByText(`${stamp} reply`).count();
    if (count < 2) throw new Error(`forward copy not visible (${count})`);
  });

  await item("history: silent send", async () => {
    await composer().fill(`${stamp} silent`);
    const sendBtn = window.getByRole("button", { name: /Send/ }).last();
    await sendBtn.click({ button: "right", position: { x: 8, y: 8 } });
    await window.waitForTimeout(800);
    const silent = window.getByRole("menuitem", { name: /without sound/i });
    await silent.click();
    await expectText(window, `${stamp} silent`);
  });

  await item("history: delete for everyone", async () => {
    // Close any overlay left by the forward picker before opening the menu.
    await window.keyboard.press("Escape");
    await window.waitForTimeout(800);
    await convo
      .getByText(`${stamp} silent`)
      .first()
      .click({ button: "right", position: { x: 8, y: 8 } });
    await window.waitForTimeout(800);
    await window
      .getByRole("menu")
      .getByRole("menuitem", { name: "Delete" })
      .click();
    await window.waitForTimeout(1000);
    await window
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click();
    await window.waitForTimeout(3000);
    if ((await convo.innerText()).includes(`${stamp} silent`))
      throw new Error("message still visible");
  });

  await item("reactions: add reaction", async () => {
    // Saved Messages has no reactions; a channel with reactions enabled does.
    await chats
      .getByRole("button", { name: /风向旗参考快讯/ })
      .first()
      .click();
    await window.waitForTimeout(4000);
    const target = convo.locator("[id^='conversation-message-']").last();
    await target.click({ button: "right" });
    await window.waitForTimeout(800);
    await window
      .getByRole("menu")
      .getByRole("menuitem", { name: "👍" })
      .click();
    await window.waitForTimeout(3000);
    if (!/👍/.test(await convo.innerText()))
      throw new Error("reaction not visible");
  });

  await item("composer: bold entity via Ctrl+B", async () => {
    await openSavedMessages();
    await composer().fill(`${stamp} bold`);
    await composer().press("Control+a");
    await composer().press("Control+b");
    await composer().press("Enter");
    await window.waitForTimeout(3000);
    const bold = convo.locator(`strong:has-text("${stamp} bold")`);
    if ((await bold.count()) < 1) throw new Error("no <strong> rendered");
  });

  await item("composer: draft persists across chat switch", async () => {
    await openSavedMessages();
    await composer().fill(`${stamp} draft`);
    await chats
      .getByRole("button", { name: /Telegram/ })
      .first()
      .click();
    await window.waitForTimeout(2500);
    await openSavedMessages();
    const value = await composer().inputValue();
    if (!value.includes(`${stamp} draft`))
      throw new Error(`draft lost: "${value}"`);
    await composer().fill("");
  });

  await item("history: page older messages", async () => {
    await chats
      .getByRole("button", { name: /Newlearner/ })
      .first()
      .click();
    await window.waitForTimeout(4000);
    const before = await convo.innerText();
    await convo.hover();
    await window.mouse.wheel(0, -60_000);
    await window.waitForTimeout(4000);
    const after = await convo.innerText();
    if (before === after)
      throw new Error("transcript did not change after paging up");
  });

  await item("media: send photo album (2 files)", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    writeFileSync("/tmp/telo-live-a.png", png);
    writeFileSync("/tmp/telo-live-b.png", png);
    await openSavedMessages();
    await window
      .locator('input[type="file"]')
      .setInputFiles(["/tmp/telo-live-a.png", "/tmp/telo-live-b.png"]);
    await window.waitForTimeout(2000);
    await composer().fill(`${stamp} album`);
    await composer().press("Enter");
    await window.waitForTimeout(8000);
    const albumText = await convo.innerText();
    if (
      !albumText.includes("telo-live-a.png") &&
      !albumText.includes(`${stamp} album`)
    )
      throw new Error("album not visible in transcript");
  });

  await item("search: global finds the message", async () => {
    await window.keyboard.press("Control+k");
    const field = window.getByRole("combobox", { name: "Search everywhere" });
    await field.waitFor({ timeout: 8000 });
    const option = window.getByRole("option", { name: new RegExp(stamp) });
    for (
      let attempt = 0;
      attempt < 3 && (await option.count()) < 1;
      attempt++
    ) {
      await field.fill(msgAEdited);
      await window.waitForTimeout(4000);
    }
    if ((await option.count()) < 1)
      throw new Error("message not in global results");
    await option.first().click();
    await window.waitForTimeout(2500);
  });

  await item("search: in-chat", async () => {
    await window.keyboard.press("Control+f");
    await window.waitForTimeout(1000);
    const field = window.getByPlaceholder(/[Ss]earch/).last();
    await field.fill(msgAEdited);
    await window.waitForTimeout(2500);
    const body = await window.locator("body").innerText();
    if (!/1 of \d+|of \d+|\d+\/\d+/.test(body))
      throw new Error("no match counter");
    await window.keyboard.press("Escape");
  });

  await item("chat-list: pin and unpin Saved Messages", async () => {
    const saved = chats.getByRole("button", { name: /Saved Messages/ }).first();
    await saved.click({ button: "right" });
    await window
      .getByRole("menu")
      .getByRole("menuitem", { name: "Pin" })
      .click();
    await window.waitForTimeout(2500);
    await saved.click({ button: "right" });
    await window
      .getByRole("menu")
      .getByRole("menuitem", { name: "Unpin" })
      .click();
    await window.waitForTimeout(2500);
  });

  await item("chat-list: mute and unmute", async () => {
    const row = () =>
      chats.getByRole("button", { name: /风向旗参考快讯/ }).first();
    await row().click({ button: "right" });
    await window
      .getByRole("menu")
      .getByRole("menuitem", { name: "Mute" })
      .click();
    await window.waitForTimeout(3000);
    await row().click({ button: "right" });
    await window
      .getByRole("menu")
      .getByRole("menuitem", { name: "Unmute" })
      .click();
    await window.waitForTimeout(2500);
  });

  await item("account-menu: opens with profile actions", async () => {
    await window
      .getByRole("button", { name: "Open account menu" })
      .first()
      .click();
    await window.waitForTimeout(1500);
    const body = await window.locator("body").innerText();
    for (const label of [
      "My Profile",
      "Contacts",
      "New Group",
      "New Channel",
      "Saved Messages",
      "Settings",
    ]) {
      if (!body.includes(label)) throw new Error(`missing: ${label}`);
    }
    await window.keyboard.press("Escape");
  });

  await item("profile: edit bio and restore", async () => {
    await window
      .getByRole("button", { name: "Open account menu" })
      .first()
      .click();
    await window.waitForTimeout(1000);
    await window.getByRole("button", { name: "Settings" }).first().click();
    await window.waitForTimeout(3000);
    const bio = window.getByLabel("Bio", { exact: true });
    await bio.fill(`telo live ${stamp}`);
    await window.waitForTimeout(2500);
    await bio.fill("");
    await window.waitForTimeout(2000);
  });

  await item("calls: history dialog opens", async () => {
    await window
      .getByRole("button", { name: "Open account menu" })
      .first()
      .click();
    await window.waitForTimeout(1000);
    await window.getByRole("button", { name: "Calls" }).first().click();
    await window.waitForTimeout(3000);
    await window.keyboard.press("Escape");
  });

  await item("contacts: dialog opens", async () => {
    await window
      .getByRole("button", { name: "Open account menu" })
      .first()
      .click();
    await window.waitForTimeout(1000);
    await window.getByRole("button", { name: "Contacts" }).first().click();
    await window.waitForTimeout(3000);
    const body = await window.locator("body").innerText();
    await window.keyboard.press("Escape");
    if (!/Contact/.test(body)) throw new Error("contacts dialog missing");
  });

  await item("group: create basic group", async () => {
    await window
      .getByRole("button", { name: "Open account menu" })
      .first()
      .click();
    await window.waitForTimeout(1000);
    await window.getByRole("button", { name: "New Group" }).first().click();
    const groupDialog = window
      .getByRole("dialog")
      .filter({ hasText: "Group name" });
    await groupDialog.waitFor({ timeout: 8000 });
    await window.waitForTimeout(1000);
    await groupDialog.getByLabel("Group name").fill(`telo-live-${stamp}`);
    await window.waitForTimeout(1500);
    const dialogText = await groupDialog.innerText();
    if (/No contacts/.test(dialogText)) {
      await window.keyboard.press("Escape");
      throw new Error(
        "BLOCKED: account has no contacts; a basic group needs at least one member",
      );
    }
    // Pick the first listed contact if any are selectable.
    const firstMember = groupDialog.locator("[aria-pressed]").first();
    if (await firstMember.count()) await firstMember.click();
    await window.waitForTimeout(500);
    await groupDialog.getByRole("button", { name: "Create group" }).click();
    await window.waitForTimeout(5000);
    await expectText(window, `telo-live-${stamp}`, 10000);
  });

  await item("channel: create channel", async () => {
    await window
      .getByRole("button", { name: "Open account menu" })
      .first()
      .click();
    await window.waitForTimeout(1000);
    await window.getByRole("button", { name: "New Channel" }).first().click();
    const channelDialog = window
      .getByRole("dialog")
      .filter({ hasText: "Channel name" });
    await channelDialog.waitFor({ timeout: 8000 });
    await window.waitForTimeout(1000);
    await channelDialog
      .getByLabel("Channel name")
      .fill(`telo-live-ch-${stamp}`);
    await window.waitForTimeout(800);
    await channelDialog.getByRole("button", { name: "Create channel" }).click();
    await window.waitForTimeout(5000);
    await expectText(window, `telo-live-ch-${stamp}`, 10000);
  });

  console.log("\n===== RESULTS =====");
  for (const [name, result] of results)
    console.log(`${result.padEnd(6)} ${name}`);
  writeFileSync(
    "/tmp/live-baseline-results.txt",
    results.map(([n, r]) => `${r.padEnd(6)} ${n}`).join("\n"),
  );
  console.log("MAIN LOG:", "/tmp/telo-live-main.log");
  await window.screenshot({ path: "/tmp/telo-live-final.png" });
  await app.close();
});
