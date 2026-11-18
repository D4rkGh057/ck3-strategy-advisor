import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { readPackageVersion, SERVER_VERSION } from "../src/version.js";

const pkgUrl = new URL("../package.json", import.meta.url);

describe("server version", () => {
  it("matches package.json", () => {
    const expected = (JSON.parse(readFileSync(pkgUrl, "utf8")) as { version: string }).version;
    expect(SERVER_VERSION).toBe(expected);
    expect(readPackageVersion()).toBe(expected);
  });

  it("falls back to 0.0.0 without throwing when package.json is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ck3-version-"));
    try {
      expect(readPackageVersion(pathToFileURL(join(dir, "package.json")))).toBe("0.0.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to 0.0.0 on invalid JSON or a missing version field", () => {
    const dir = mkdtempSync(join(tmpdir(), "ck3-version-"));
    try {
      const bad = join(dir, "bad.json");
      writeFileSync(bad, "{not json");
      expect(readPackageVersion(pathToFileURL(bad))).toBe("0.0.0");
      const noVer = join(dir, "nover.json");
      writeFileSync(noVer, "{}");
      expect(readPackageVersion(pathToFileURL(noVer))).toBe("0.0.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
