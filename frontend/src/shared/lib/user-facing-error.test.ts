import { describe, expect, it } from "vitest";

import {
  isTechnicalErrorMessage,
  userFacingErrorDetail,
} from "./user-facing-error";

describe("userFacingErrorDetail", () => {
  it("hides TDLib and protocol jargon", () => {
    expect(userFacingErrorDetail(new Error("TDLib client closed"))).toBeNull();
    expect(userFacingErrorDetail(new Error("REACTION_INVALID"))).toBeNull();
    expect(
      userFacingErrorDetail(new Error("400 PHONE_CODE_INVALID")),
    ).toBeNull();
    expect(isTechnicalErrorMessage("teleproto flood")).toBe(true);
  });

  it("keeps a human sentence", () => {
    expect(userFacingErrorDetail(new Error("Could not save the file."))).toBe(
      "Could not save the file.",
    );
  });
});
