import {
  demoTest as test,
  expect,
  test as plainTest,
  waitForDemoWorkspace,
} from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Desktop pointer targets owe 40px. A class-name grep cannot prove that: the
 * height that survives is whatever wins Tailwind's merge, a wrapper can pad a
 * small glyph up to a real target, and `::before` expansion adds hit area that
 * `getBoundingClientRect` never reports. So this measures what the pointer
 * actually gets, by probing outward from each control until the point stops
 * resolving to it.
 *
 * Avatars are controls now that tapping one opens a profile, so they are swept
 * like any other: each keeps its Telegram-sized disc and reaches the floor
 * through `::before` expansion. Plain icons still never appear here, because
 * the sweep only collects enabled, visible, pointer-reachable controls.
 */
const MIN_TARGET = 40;

interface Target {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

interface Collision {
  readonly a: string;
  readonly b: string;
  readonly overlap: string;
}

/**
 * The gate asks for 40px targets that do not overlap, and the size sweep only
 * answers the first half. The overlap that matters is between neighbours: the
 * way a target reaches 40px here is often a pseudo-element pushing past the
 * visible control, and pushed far enough it lands on the button beside it, so
 * the edge of one control quietly activates the other.
 *
 * Only controls sharing a parent are compared. Boxes from different stacking
 * layers intersect constantly and by design — an open popover sits over the
 * toolbar that spawned it — and reporting those would bury the real thing.
 */
function findCollisions(selector: string): Collision[] {
  const controls = [...document.querySelectorAll(selector)].filter(
    (control): control is HTMLElement => {
      if (!(control instanceof HTMLElement)) return false;
      if (control.hasAttribute("disabled")) return false;
      if (control.getAttribute("aria-hidden") === "true") return false;
      const style = getComputedStyle(control);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      if (style.pointerEvents === "none") return false;
      const box = control.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    },
  );

  const name = (control: HTMLElement) =>
    control.getAttribute("aria-label") ??
    control.getAttribute("placeholder") ??
    control.textContent?.trim().slice(0, 30) ??
    control.tagName.toLowerCase();

  const collisions: Collision[] = [];
  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      const first = controls[i];
      const second = controls[j];
      if (first.parentElement !== second.parentElement) continue;

      const a = first.getBoundingClientRect();
      const b = second.getBoundingClientRect();
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      // A shared edge is how adjacent rows are supposed to sit; only a real
      // area of intersection is a collision.
      if (x <= 1 || y <= 1) continue;

      collisions.push({
        a: name(first),
        b: name(second),
        overlap: `${Math.round(x)}x${Math.round(y)}`,
      });
    }
  }
  return collisions;
}

const CONTROL_SELECTOR =
  'button, [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="switch"], input:not([type="hidden"]), textarea, select';

function measureUndersized({
  minTarget,
  selector,
}: {
  minTarget: number;
  selector: string;
}): Target[] {
  const controls = document.querySelectorAll(selector);

  const hits = (x: number, y: number, control: Element): boolean => {
    const found = document.elementFromPoint(x, y);
    return found === control || control.contains(found);
  };

  /** Distance the target extends past `from` along one axis, in CSS pixels. */
  const reach = (
    control: Element,
    from: number,
    fixed: number,
    step: number,
    horizontal: boolean,
  ): number => {
    const limit = 24;
    let travelled = 0;
    for (let offset = step; Math.abs(offset) <= limit; offset += step) {
      const x = horizontal ? from + offset : fixed;
      const y = horizontal ? fixed : from + offset;
      if (!hits(x, y, control)) break;
      travelled = Math.abs(offset);
    }
    return travelled;
  };

  const undersized: Target[] = [];
  for (const control of controls) {
    if (!(control instanceof HTMLElement)) continue;
    if (control.hasAttribute("disabled")) continue;
    if (control.getAttribute("aria-hidden") === "true") continue;

    const style = getComputedStyle(control);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (style.pointerEvents === "none") continue;

    const box = control.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;

    const midX = box.left + box.width / 2;
    const midY = box.top + box.height / 2;

    // Only measure from a point that resolves to the control, otherwise an
    // overlay is covering it and the number would be meaningless.
    if (!hits(midX, midY, control)) continue;

    // A field is routinely smaller than the padded wrapper that focuses it, so
    // credit the outermost ancestor whose centre still resolves to this
    // control — that is the box a pointer can aim at.
    let outer = box;
    for (
      let ancestor = control.parentElement;
      ancestor && ancestor !== document.body;
      ancestor = ancestor.parentElement
    ) {
      const ancestorBox = ancestor.getBoundingClientRect();
      if (ancestorBox.width === 0 || ancestorBox.height === 0) break;
      if (
        !hits(
          ancestorBox.left + ancestorBox.width / 2,
          ancestorBox.top + ancestorBox.height / 2,
          control,
        )
      ) {
        break;
      }
      outer = ancestorBox;
    }

    // A labelled control is activated by clicking its label, so the pointer
    // target is the union of the two boxes even when the label sits beside the
    // control rather than around it. Without this a 20px radio disc reads as a
    // 20px target when its real one spans the whole row.
    const labels = (control as HTMLButtonElement).labels;
    for (const label of labels ?? []) {
      const labelBox = label.getBoundingClientRect();
      if (labelBox.width === 0 || labelBox.height === 0) continue;
      const left = Math.min(outer.left, labelBox.left);
      const top = Math.min(outer.top, labelBox.top);
      outer = new DOMRect(
        left,
        top,
        Math.max(outer.right, labelBox.right) - left,
        Math.max(outer.bottom, labelBox.bottom) - top,
      );
    }

    // Then probe past the edges, which is the only way `::before` hit
    // expansion shows up at all.
    const outerMidX = outer.left + outer.width / 2;
    const outerMidY = outer.top + outer.height / 2;
    const width =
      outer.width +
      reach(control, outer.left, outerMidY, -1, true) +
      reach(control, outer.right, outerMidY, 1, true);
    const height =
      outer.height +
      reach(control, outer.top, outerMidX, -1, false) +
      reach(control, outer.bottom, outerMidX, 1, false);

    // The probe steps a whole pixel at a time, so a control sitting on a
    // fractional offset — which is where sub-pixel layout puts most of them —
    // under-reports by up to 1px. Tolerate exactly that much and no more:
    // claiming finer precision than the probe has would just make the failures
    // arbitrary. A control genuinely under the floor still fails by margin.
    if (width + 1 >= minTarget && height + 1 >= minTarget) continue;

    undersized.push({
      label:
        control.getAttribute("aria-label") ??
        control.getAttribute("placeholder") ??
        control.textContent?.trim().slice(0, 40) ??
        control.tagName.toLowerCase(),
      width: Math.round(width),
      height: Math.round(height),
    });
  }
  return undersized;
}

/**
 * A control measured mid-animation reports its transient size, not its settled
 * one: the morphing dialog caught at scale 0.95 makes a compliant 40px button
 * read as 38px. In isolation that window closes before the assertion runs, but
 * under a loaded suite it does not, so wait for two consecutive polls to agree
 * on every control's geometry before believing any of it.
 */
async function waitForSettledLayout(window: Page): Promise<void> {
  await window.waitForFunction(
    (selector: string) => {
      const geometry = [...document.querySelectorAll(selector)]
        .map((control) => {
          const box = control.getBoundingClientRect();
          return `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}`;
        })
        .join("|");
      const scope = globalThis as { __teloLayout?: string };
      const settled = scope.__teloLayout === geometry;
      scope.__teloLayout = geometry;
      return settled;
    },
    CONTROL_SELECTOR,
    { polling: 100 },
  );
}

async function sweep(
  window: Page,
): Promise<{ undersized: Target[]; collisions: Collision[] }> {
  await waitForSettledLayout(window);
  const undersized = await window.evaluate(measureUndersized, {
    minTarget: MIN_TARGET,
    selector: CONTROL_SELECTOR,
  });
  const collisions = await window.evaluate(findCollisions, CONTROL_SELECTOR);
  return { undersized, collisions };
}

async function openDesignChat(window: Page): Promise<void> {
  await waitForDemoWorkspace(window);
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();
  await expect(
    window.getByRole("heading", { name: "Telo Design" }),
  ).toBeVisible();
}

test("keeps the chat surfaces at a 40px pointer target", async ({ window }) => {
  await waitForDemoWorkspace(window);

  // Chat list, folder strip and search field: the densest surface, and the one
  // whose tabs and field were previously pinned below the floor.
  expect(await sweep(window)).toEqual({ undersized: [], collisions: [] });

  await openDesignChat(window);

  // Conversation surface: header actions, transcript affordances, composer rail.
  expect(await sweep(window)).toEqual({ undersized: [], collisions: [] });
});

test("keeps the overlays at a 40px pointer target", async ({ window }) => {
  await openDesignChat(window);

  // A popover, whose grid of emoji cells is the densest run of controls in the
  // app and so the likeliest place for a container to squeeze them.
  await window.getByRole("button", { name: "Emoji and stickers" }).click();
  await expect(
    window.getByRole("textbox", { name: "Search emoji…" }),
  ).toBeVisible();
  expect(await sweep(window)).toEqual({ undersized: [], collisions: [] });
  await window.keyboard.press("Escape");

  const conversation = window.getByRole("region", { name: "Conversation" });

  // The media viewer puts its controls over the image rather than beside it,
  // so nothing pads them if they are undersized.
  await conversation.hover();
  // The transcript window renders only the visible range: after the jump to
  // the top, wheel down until the photo bubble enters the rendered window.
  await window.mouse.wheel(0, -100_000);
  const heroPhoto = conversation.getByRole("button", {
    name: "telo-hero.png",
  });
  for (let i = 0; i < 20 && !(await heroPhoto.isVisible()); i++) {
    await window.mouse.wheel(0, 1_200);
  }
  await heroPhoto.click();
  const viewer = window.getByRole("dialog", { name: "Media viewer" });
  await expect(viewer).toBeVisible();
  expect(await sweep(window)).toEqual({ undersized: [], collisions: [] });
  await window.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);

  // A centered modal, whose close button keeps a 32px disc on purpose, so this
  // is the case that only passes because its hit box is padded past the disc.
  // Outgoing, because only an own message offers Delete.
  const target =
    "Agreed. Keep the composer anchored and let only the message list scroll.";
  await expect(conversation).toContainText(target);
  await conversation.getByText(target).click({ button: "right" });
  await window
    .getByRole("menu")
    .getByRole("menuitem", { name: "Delete" })
    .click();

  const dialog = window.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await sweep(window)).toEqual({ undersized: [], collisions: [] });
});

test("keeps the right-column panels at a 40px pointer target", async ({
  window,
}) => {
  await openDesignChat(window);

  // Agent panel and chat profile share the right column and close each other,
  // so they have to be swept in sequence rather than together.
  await window.getByRole("button", { name: "Open agent" }).click();
  await expect(
    window.getByRole("complementary", { name: "Agent" }),
  ).toBeVisible();
  expect(await sweep(window)).toEqual({ undersized: [], collisions: [] });

  await window.getByRole("button", { name: "Chat info" }).click();
  await expect(
    window.getByRole("complementary", { name: "Chat info" }),
  ).toBeVisible();
  expect(await sweep(window)).toEqual({ undersized: [], collisions: [] });
});

test("keeps the menu surfaces at a 40px pointer target", async ({ window }) => {
  await openDesignChat(window);

  // Right-click menus carry the densest run of menuitems and are reached far
  // more often than any dialog.
  const conversation = window.getByRole("region", { name: "Conversation" });
  await conversation
    .getByText(
      "Agreed. Keep the composer anchored and let only the message list scroll.",
    )
    .click({ button: "right" });
  await expect(window.getByRole("menu")).toBeVisible();
  expect(await sweep(window)).toEqual({ undersized: [], collisions: [] });
  await window.keyboard.press("Escape");

  // The command palette is a Combobox rather than a menu, so its options are a
  // different control type from everything above. Type first, because an empty
  // palette has no option rows to measure.
  await window.keyboard.press("ControlOrMeta+K");
  const field = window.getByRole("combobox", { name: "Search everywhere" });
  await expect(field).toBeVisible();
  await field.fill("Product Notes");
  await expect(
    window.getByRole("option", { name: /Product Notes/ }),
  ).toBeVisible();
  expect(await sweep(window)).toEqual({ undersized: [], collisions: [] });
  await window.keyboard.press("Escape");

  // The account menu is the one popover whose rows mix an avatar with text.
  await window.getByRole("button", { name: "Open account menu" }).click();
  await expect(
    window.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  expect(await sweep(window)).toEqual({ undersized: [], collisions: [] });
});

test("keeps settings at a 40px pointer target", async ({ window }) => {
  await waitForDemoWorkspace(window);

  // Settings is the one surface built from form controls rather than icon
  // buttons: switches, radios, a slider and several selects.
  await window.getByRole("button", { name: "Open account menu" }).click();
  await window.getByRole("button", { name: "Settings", exact: true }).click();

  // Every pane, not just the one Settings opens on: the rail splits this
  // surface into seven screens, and a control that misses the floor on one of
  // them is invisible to a sweep of another.
  for (const pane of [
    "Account",
    "Appearance",
    "Chat settings",
    "Notifications",
    "Folders",
    "Agent settings",
    "Data and storage",
  ]) {
    await window.getByRole("button", { name: pane, exact: true }).click();
    await expect(
      window.getByRole("heading", { name: pane, exact: true }),
    ).toBeVisible();
    expect(await sweep(window)).toEqual({ undersized: [], collisions: [] });
  }
});

// Onboarding never renders in the demo workspace, so it needs the plain
// fixture and a test of its own.
plainTest(
  "keeps onboarding controls at a 40px pointer target",
  async ({ window }) => {
    await expect(
      window.getByRole("button", { name: "Start Messaging" }),
    ).toBeVisible();
    expect(await sweep(window)).toEqual({ undersized: [], collisions: [] });
  },
);
