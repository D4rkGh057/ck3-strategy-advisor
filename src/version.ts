import { readFileSync } from "node:fs";

const FALLBACK_VERSION = "0.0.0";

// src/version.ts and dist/version.js both sit one level below the package root.
const DEFAULT_PACKAGE_JSON = new URL("../package.json", import.meta.url);

/** Reads `version` from package.json. Never throws; returns "0.0.0" on any failure. */
export function readPackageVersion(packageJson: URL = DEFAULT_PACKAGE_JSON): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(packageJson, "utf8"));
    const version = (parsed as { version?: unknown } | null)?.version;
    return typeof version === "string" && version ? version : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

export const SERVER_VERSION = readPackageVersion();
