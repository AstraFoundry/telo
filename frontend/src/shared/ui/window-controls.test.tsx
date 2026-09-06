import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { copy } from "../config/copy";
import { installTeloApiMock } from "../test/mock-telo";

describe("WindowControls", () => {
  beforeEach(() => {
    installTeloApiMock();
  });

  it("paints nothing when the window still has native chrome", async () => {
    const { WindowControls } = await import("./window-controls");
    render(<WindowControls />);
    expect(screen.queryByRole("button", { name: copy.windowClose })).toBeNull();
  });

  it("sends close, minimize, and maximize through the shell", async () => {
    const telo = installTeloApiMock();
    telo.shell.frameless = true;
    const { WindowControls } = await import("./window-controls");
    render(<WindowControls />);

    fireEvent.click(screen.getByRole("button", { name: copy.windowClose }));
    fireEvent.click(screen.getByRole("button", { name: copy.windowMinimize }));
    fireEvent.click(screen.getByRole("button", { name: copy.windowMaximize }));

    expect(telo.shell.windowControl).toHaveBeenCalledWith("close");
    expect(telo.shell.windowControl).toHaveBeenCalledWith("minimize");
    expect(telo.shell.windowControl).toHaveBeenCalledWith("maximize");
  });
});
