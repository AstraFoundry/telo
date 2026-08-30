import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Desktop pointer targets owe 40px. A class-name grep cannot prove that: the
 * height that survives is whatever wins Tailwind's merge, a wrapper can pad a
 * small glyph up to a real target, and `::before` expansion adds hit area that
 * `getBoundingClientRect` never reports. So this measures what the pointer
 * actually gets, by probing outward from each control until the point stops
 * resolving to it.
 *
 * Icons and avatars never appear here because they are not controls; the sweep
 * only collects enabled, visible, pointer-reachable ones.
 */
const MIN_TARGET = 40;

interface Target {
  readonly label: string;
  readonly width: number;
  readonly height: number;
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

    // Then probe past the edges, which is the only way `::before` hit
    // expansion shows up at all.
    const outerMidX = outer.left + outer.width / 2;
    const outerMidY = outer.top + outer.height / 2;
    const width =
      outer.width +
      reach(control, outer.left, outerMidY, -2, true) +
      reach(control, outer.right, outerMidY, 2, true);
    const height =
      outer.height +
      reach(control, outer.top, outerMidX, -2, false) +
      reach(control, outer.bottom, outerMidX, 2, false);

    if (width + 0.5 >= minTarget && height + 0.5 >= minTarget) continue;

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

async function sweep(window: Page): Promise<Target[]> {
  await waitForSettledLayout(window);
  return window.evaluate(measureUndersized, {
    minTarget: MIN_TARGET,
    selector: CONTROL_SELECTOR,
  });
}

test("keeps every reachable control at a 40px pointer target", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  // Chat list, folder strip and search field: the densest surface, and the one
  // whose tabs and field were previously pinned below the floor.
  expect(await sweep(window)).toEqual([]);

  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();
  await expect(
    window.getByRole("heading", { name: "Telo Design" }),
  ).toBeVisible();

  // Conversation surface: header actions, transcript affordances, composer rail.
  expect(await sweep(window)).toEqual([]);

  // A centered modal, whose close button keeps a 32px disc on purpose, so this
  // is the case that only passes because its hit box is padded past the disc.
  const conversation = window.getByRole("region", { name: "Conversation" });
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
  expect(await sweep(window)).toEqual([]);

  await window.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
