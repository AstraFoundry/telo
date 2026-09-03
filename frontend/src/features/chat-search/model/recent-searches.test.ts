import { describe, expect, it } from "vitest";

import {
  RECENT_SEARCHES_MAX,
  pushRecentSearch,
  removeRecentSearch,
} from "./recent-searches";

describe("pushRecentSearch", () => {
  it("prepends a new id", () => {
    expect(pushRecentSearch(["b", "c"], "a")).toEqual(["a", "b", "c"]);
  });

  it("moves a repeated id to the front instead of duplicating it", () => {
    expect(pushRecentSearch(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("caps the list at Web K's twenty", () => {
    const full = Array.from({ length: RECENT_SEARCHES_MAX }, (_, i) => `c${i}`);
    expect(pushRecentSearch(full, "new")).toHaveLength(RECENT_SEARCHES_MAX);
    expect(pushRecentSearch(full, "new")[0]).toBe("new");
    expect(pushRecentSearch(full, "new")).not.toContain(
      full[RECENT_SEARCHES_MAX - 1],
    );
  });

  it("ignores an empty id", () => {
    expect(pushRecentSearch(["a"], "")).toEqual(["a"]);
  });
});

describe("removeRecentSearch", () => {
  it("drops the id", () => {
    expect(removeRecentSearch(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("is a no-op for an id the list does not hold", () => {
    expect(removeRecentSearch(["a"], "z")).toEqual(["a"]);
  });
});
