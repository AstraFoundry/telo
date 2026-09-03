import { describe, expect, it } from "vitest";

import { CronExpression, parseCronField } from "./agent-cron";

function at(date: string): Date {
  return new Date(date);
}

describe("parseCronField", () => {
  it("expands wildcards, lists, ranges, and steps", () => {
    expect(parseCronField("*", { min: 0, max: 4 })).toEqual([0, 1, 2, 3, 4]);
    expect(parseCronField("1,3", { min: 0, max: 59 })).toEqual([1, 3]);
    expect(parseCronField("2-4", { min: 0, max: 59 })).toEqual([2, 3, 4]);
    expect(parseCronField("*/2", { min: 0, max: 5 })).toEqual([0, 2, 4]);
    expect(parseCronField("1-5/2", { min: 0, max: 59 })).toEqual([1, 3, 5]);
    expect(parseCronField("5/10", { min: 0, max: 25 })).toEqual([5, 15, 25]);
  });

  it("treats day-of-week 7 as Sunday", () => {
    // 2026-09-06 is a Sunday; both 0 and 7 fire on it from a Saturday.
    for (const dow of ["0", "7", "sun"]) {
      const cron = CronExpression.parse(`0 9 * * ${dow}`);
      expect(cron.nextAfter(at("2026-09-05T10:00:00"))).toEqual(
        at("2026-09-06T09:00:00"),
      );
    }
  });

  it("accepts three-letter month and day names", () => {
    expect(
      parseCronField(
        "mon-fri",
        { min: 0, max: 7 },
        {
          mon: 1,
          tue: 2,
          wed: 3,
          thu: 4,
          fri: 5,
          sat: 6,
          sun: 0,
        },
      ),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects invalid fields", () => {
    expect(() => parseCronField("", { min: 0, max: 59 })).toThrow();
    expect(() => parseCronField("99", { min: 0, max: 59 })).toThrow();
    expect(() => parseCronField("x", { min: 0, max: 59 })).toThrow();
    expect(() => parseCronField("5-2", { min: 0, max: 59 })).toThrow();
    expect(() => parseCronField("*/0", { min: 0, max: 59 })).toThrow();
  });
});

describe("CronExpression.parse", () => {
  it("rejects expressions that do not have exactly 5 fields", () => {
    expect(() => CronExpression.parse("* * * *")).toThrow(/5 fields/);
    expect(() => CronExpression.parse("* * * * * *")).toThrow(/5 fields/);
  });
});

describe("CronExpression.nextAfter", () => {
  it("fires every minute for a full wildcard", () => {
    const cron = CronExpression.parse("* * * * *");
    expect(cron.nextAfter(at("2026-09-03T10:20:30"))).toEqual(
      at("2026-09-03T10:21:00"),
    );
  });

  it("fires at a fixed daily time, skipping to the next day when past", () => {
    const cron = CronExpression.parse("30 9 * * *");
    expect(cron.nextAfter(at("2026-09-03T08:00:00"))).toEqual(
      at("2026-09-03T09:30:00"),
    );
    expect(cron.nextAfter(at("2026-09-03T09:30:00"))).toEqual(
      at("2026-09-04T09:30:00"),
    );
  });

  it("steps through minutes within an hour", () => {
    const cron = CronExpression.parse("*/15 * * * *");
    expect(cron.nextAfter(at("2026-09-03T10:07:00"))).toEqual(
      at("2026-09-03T10:15:00"),
    );
  });

  it("honours day-of-week names", () => {
    // 2026-09-03 is a Thursday; the next Monday is 2026-09-07.
    const cron = CronExpression.parse("0 9 * * mon");
    expect(cron.nextAfter(at("2026-09-03T10:00:00"))).toEqual(
      at("2026-09-07T09:00:00"),
    );
  });

  it("matches either day field when both are restricted", () => {
    // 13th of any month OR any Friday; 2026-09-03 is a Thursday, so the
    // next fire is the very next day (Friday 2026-09-04).
    const cron = CronExpression.parse("0 12 13 * fri");
    expect(cron.nextAfter(at("2026-09-03T00:00:00"))).toEqual(
      at("2026-09-04T12:00:00"),
    );
    // A Thursday that is not the 13th must not fire.
    const onlyFriday = CronExpression.parse("0 12 * * fri");
    expect(onlyFriday.nextAfter(at("2026-09-03T12:00:00"))).toEqual(
      at("2026-09-04T12:00:00"),
    );
  });

  it("handles leap-day schedules across years", () => {
    const cron = CronExpression.parse("0 0 29 2 *");
    expect(cron.nextAfter(at("2026-09-03T00:00:00"))).toEqual(
      at("2028-02-29T00:00:00"),
    );
  });

  it("returns null for impossible schedules", () => {
    const cron = CronExpression.parse("0 0 30 2 *");
    expect(cron.nextAfter(at("2026-09-03T00:00:00"))).toBeNull();
  });

  it("rolls month and year boundaries", () => {
    const cron = CronExpression.parse("0 0 1 1 *");
    expect(cron.nextAfter(at("2026-12-31T23:59:00"))).toEqual(
      at("2027-01-01T00:00:00"),
    );
  });
});
