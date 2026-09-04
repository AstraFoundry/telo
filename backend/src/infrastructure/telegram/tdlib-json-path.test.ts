import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { packagedTdjsonFileName, resolveTdjsonPath } from "./tdlib-json-path";

describe("resolveTdjsonPath", () => {
  it("returns a loadable unpackaged libtdjson path", () => {
    const tdjson = resolveTdjsonPath({
      isPackaged: false,
      resourcesPath: "/unused",
    });
    expect(tdjson.length).toBeGreaterThan(0);
    expect(tdjson).toMatch(/tdjson|libtdjson/i);
  });

  it("loads the staged extraResources copy when packaged", () => {
    const resources = path.join(os.tmpdir(), `telo-tdjson-${Date.now()}`);
    const nativeDir = path.join(resources, "tdlib-native");
    mkdirSync(nativeDir, { recursive: true });
    const staged = path.join(nativeDir, packagedTdjsonFileName());
    writeFileSync(staged, "");

    expect(
      resolveTdjsonPath({ isPackaged: true, resourcesPath: resources }),
    ).toBe(staged);
  });

  it("throws when the packaged extraResources copy is missing", () => {
    expect(() =>
      resolveTdjsonPath({
        isPackaged: true,
        resourcesPath: path.join(
          os.tmpdir(),
          `telo-tdjson-missing-${Date.now()}`,
        ),
      }),
    ).toThrow(/Packaged libtdjson missing/);
  });
});
