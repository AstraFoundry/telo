/**
 * Five-field cron expressions (minute hour day-of-month month day-of-week),
 * evaluated in the machine's local timezone — the desktop equivalent of
 * server cron, where "9:00" means 9:00 for the person at the keyboard.
 *
 * Supported syntax per field: star wildcard, a number, a range `a-b`, a step
 * (`star/n` or `a-b/n` with a literal `*`), and comma-separated lists of
 * those. Month and
 * day-of-week also
 * accept three-letter English names (jan…dec, sun…sat). Day-of-week accepts
 * both 0 and 7 for Sunday. When day-of-month and day-of-week are both
 * restricted, a day matches when either field matches (Vixie cron
 * semantics); when one is `*`, only the other constrains.
 */

const MINUTE = { min: 0, max: 59 } as const;
const HOUR = { min: 0, max: 23 } as const;
const DAY_OF_MONTH = { min: 1, max: 31 } as const;
const MONTH = { min: 1, max: 12 } as const;
const DAY_OF_WEEK = { min: 0, max: 7 } as const;

const MONTH_NAMES: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const DAY_NAMES: Readonly<Record<string, number>> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/** Next-fire search gives up after this many years (e.g. "Feb 30"). */
const SEARCH_HORIZON_YEARS = 4;

interface FieldBounds {
  readonly min: number;
  readonly max: number;
}

function parseValue(
  raw: string,
  bounds: FieldBounds,
  names: Readonly<Record<string, number>> | null,
  field: string,
): number {
  const named = names?.[raw.toLowerCase()];
  const value = named ?? (/^\d+$/.test(raw) ? Number(raw) : NaN);
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new Error(`Invalid ${field} value "${raw}" in cron expression`);
  }
  return value;
}

/**
 * Parses one cron field into the sorted set of matching values. An empty
 * array is impossible: every valid field matches at least one value.
 */
export function parseCronField(
  field: string,
  bounds: FieldBounds,
  names: Readonly<Record<string, number>> | null = null,
): ReadonlyArray<number> {
  const values = new Set<number>();
  for (const term of field.split(",")) {
    const stepMatch = /^(.+)\/(\d+)$/.exec(term);
    const base = stepMatch ? stepMatch[1]! : term;
    const step = stepMatch ? Number(stepMatch[2]) : 1;
    if (step < 1) {
      throw new Error(`Invalid step "${term}" in cron expression`);
    }
    let lo: number;
    let hi: number;
    if (base === "*") {
      lo = bounds.min;
      hi = bounds.max;
    } else if (base.includes("-")) {
      const [rawLo, rawHi] = base.split("-", 2);
      lo = parseValue(rawLo!, bounds, names, term);
      hi = parseValue(rawHi!, bounds, names, term);
      if (lo > hi) {
        throw new Error(`Invalid range "${term}" in cron expression`);
      }
    } else {
      const single = parseValue(base, bounds, names, term);
      // A bare value with a step ("5/10") runs from the value to the top.
      lo = single;
      hi = stepMatch ? bounds.max : single;
    }
    for (let value = lo; value <= hi; value += step) {
      values.add(value);
    }
  }
  return [...values].sort((a, b) => a - b);
}

export class CronExpression {
  private constructor(
    readonly source: string,
    private readonly minutes: ReadonlyArray<number>,
    private readonly hours: ReadonlyArray<number>,
    private readonly daysOfMonth: ReadonlyArray<number>,
    private readonly months: ReadonlyArray<number>,
    private readonly daysOfWeek: ReadonlyArray<number>,
    private readonly domRestricted: boolean,
    private readonly dowRestricted: boolean,
  ) {}

  static parse(source: string): CronExpression {
    const fields = source.trim().split(/\s+/);
    if (fields.length !== 5) {
      throw new Error(
        `Cron expression needs 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}`,
      );
    }
    const [minute, hour, dom, month, dow] = fields as [
      string,
      string,
      string,
      string,
      string,
    ];
    // Day-of-week accepts both 0 and 7 for Sunday; normalize to 0.
    const daysOfWeek = parseCronField(dow, DAY_OF_WEEK, DAY_NAMES).map(
      (value) => (value === 7 ? 0 : value),
    );
    return new CronExpression(
      source.trim(),
      parseCronField(minute, MINUTE),
      parseCronField(hour, HOUR),
      parseCronField(dom, DAY_OF_MONTH),
      parseCronField(month, MONTH, MONTH_NAMES),
      [...new Set(daysOfWeek)].sort((a, b) => a - b),
      dom !== "*",
      dow !== "*",
    );
  }

  private matchesDay(date: Date): boolean {
    if (!this.domRestricted && !this.dowRestricted) return true;
    const domMatches = this.daysOfMonth.includes(date.getDate());
    const dowMatches = this.daysOfWeek.includes(date.getDay());
    if (this.domRestricted && this.dowRestricted) {
      return domMatches || dowMatches;
    }
    return this.domRestricted ? domMatches : dowMatches;
  }

  /**
   * The first fire strictly after `after`, minute-precision, or null when
   * the expression never fires within the search horizon. Field-skipping:
   * a failing month/day/hour jumps straight to the next candidate unit
   * instead of stepping minute by minute.
   */
  nextAfter(after: Date): Date | null {
    const candidate = new Date(after.getTime());
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);
    const horizon = new Date(after.getTime());
    horizon.setFullYear(horizon.getFullYear() + SEARCH_HORIZON_YEARS);
    while (candidate <= horizon) {
      if (!this.months.includes(candidate.getMonth() + 1)) {
        candidate.setDate(1);
        candidate.setHours(0, 0, 0, 0);
        candidate.setMonth(candidate.getMonth() + 1);
        continue;
      }
      if (!this.matchesDay(candidate)) {
        candidate.setHours(0, 0, 0, 0);
        candidate.setDate(candidate.getDate() + 1);
        continue;
      }
      if (!this.hours.includes(candidate.getHours())) {
        candidate.setMinutes(0, 0, 0);
        candidate.setHours(candidate.getHours() + 1);
        continue;
      }
      if (!this.minutes.includes(candidate.getMinutes())) {
        candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
        continue;
      }
      return candidate;
    }
    return null;
  }

  toString(): string {
    return this.source;
  }
}
