import { describe, expect, it } from "vitest";

import {
  COUNTRIES,
  detectCountryCode,
  getCountry,
  parseInternationalPhone,
} from "./countries";

describe("countries", () => {
  it("covers the ITU dialing plan with English display names", () => {
    expect(COUNTRIES.length).toBeGreaterThan(200);

    const us = getCountry("US");
    expect(us.name).toBe("United States");
    expect(us.dialCode).toBe("1");

    expect(getCountry("CN").dialCode).toBe("86");
    expect(getCountry("GB").dialCode).toBe("44");
  });

  it("detects the default country from a language tag", () => {
    expect(detectCountryCode("en-US")).toBe("US");
    expect(detectCountryCode("zh-Hans-CN")).toBe("CN");
    expect(detectCountryCode("de-DE")).toBe("DE");
    // Regionless or malformed tags fall back to the default.
    expect(detectCountryCode("")).toBe("US");
  });

  it("splits a pasted international number by longest dialing-code match", () => {
    expect(parseInternationalPhone("+15555550100")).toEqual({
      country: getCountry("US"),
      nationalNumber: "5555550100",
    });
    expect(parseInternationalPhone("+447700900123")).toEqual({
      country: getCountry("GB"),
      nationalNumber: "7700900123",
    });
    // Shared dialing codes resolve to the main territory.
    expect(parseInternationalPhone("+79161234567")?.country.code).toBe("RU");
  });

  it("ignores input without an international prefix or without a known code", () => {
    expect(parseInternationalPhone("5555550100")).toBeNull();
    expect(parseInternationalPhone("+999")).toBeNull();
    expect(parseInternationalPhone("+")).toBeNull();
  });
});
