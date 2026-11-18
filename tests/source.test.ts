import { expect, test, vi } from "vitest";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SaveFileSource } from "../src/source.js";
import { makeTextEnvelope, makeBinaryEnvelope } from "./fixtures/make-envelope.js";

// Names whose stat() rejects, simulating a save that vanishes between readdir and stat.
const statFails = vi.hoisted(() => new Set<string>());
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: ((path: Parameters<typeof actual.stat>[0], ...rest: unknown[]) => {
      const name = String(path).split(/[\\/]/).pop()!;
      if (statFails.has(name)) return Promise.reject(new Error("ENOENT"));
      return (actual.stat as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof actual.stat,
  };
});

test("latest() returns the newest .ck3 and ignores last_save.ck3", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-"));
  writeFileSync(join(dir, "old.ck3"), "a");
  writeFileSync(join(dir, "new.ck3"), "b");
  writeFileSync(join(dir, "last_save.ck3"), "c");
  utimesSync(join(dir, "old.ck3"), new Date(1000), new Date(1000));
  utimesSync(join(dir, "new.ck3"), new Date(9000), new Date(9000));
  utimesSync(join(dir, "last_save.ck3"), new Date(99999), new Date(99999));

  const src = new SaveFileSource({ saveDir: dir });
  const ref = await src.latest();
  expect(ref?.path.endsWith("new.ck3")).toBe(true);
  expect((await src.read(ref!)).toString()).toBe("b");
});

test("latest() skips a newer binary autosave for an older parseable save", async () => {
  // CK3 autosaves use the binary token format regardless of Ironman, and are
  // usually the newest file. latest() must pick the newest *text* save instead.
  const dir = mkdtempSync(join(tmpdir(), "ck3-"));
  writeFileSync(join(dir, "manual.ck3"), makeTextEnvelope("gamestate={}"));
  writeFileSync(join(dir, "autosave.ck3"), makeBinaryEnvelope());
  utimesSync(join(dir, "manual.ck3"), new Date(1000), new Date(1000));
  utimesSync(join(dir, "autosave.ck3"), new Date(9000), new Date(9000));

  const ref = await new SaveFileSource({ saveDir: dir }).latest();
  expect(ref?.path.endsWith("manual.ck3")).toBe(true);
});

test("latest() falls back to the newest save when none are parseable", async () => {
  // No text save present — return the newest anyway so the caller surfaces the
  // friendly binary/Ironman message rather than "no save found".
  const dir = mkdtempSync(join(tmpdir(), "ck3-"));
  writeFileSync(join(dir, "old.ck3"), makeBinaryEnvelope());
  writeFileSync(join(dir, "new.ck3"), makeBinaryEnvelope());
  utimesSync(join(dir, "old.ck3"), new Date(1000), new Date(1000));
  utimesSync(join(dir, "new.ck3"), new Date(9000), new Date(9000));

  const ref = await new SaveFileSource({ saveDir: dir }).latest();
  expect(ref?.path.endsWith("new.ck3")).toBe(true);
});

test("latest() returns null on empty dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-"));
  expect(await new SaveFileSource({ saveDir: dir }).latest()).toBeNull();
});

test("latest() returns the newest parseable save in the normal case", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-"));
  writeFileSync(join(dir, "a.ck3"), makeTextEnvelope("gamestate={}"));
  writeFileSync(join(dir, "b.ck3"), makeTextEnvelope("gamestate={}"));
  utimesSync(join(dir, "a.ck3"), new Date(1000), new Date(1000));
  utimesSync(join(dir, "b.ck3"), new Date(9000), new Date(9000));
  const ref = await new SaveFileSource({ saveDir: dir }).latest();
  expect(ref?.path.endsWith("b.ck3")).toBe(true);
});

test("latest() skips a save whose stat fails and still returns the newest remaining", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-"));
  writeFileSync(join(dir, "old.ck3"), makeTextEnvelope("gamestate={}"));
  writeFileSync(join(dir, "vanished.ck3"), makeTextEnvelope("gamestate={}"));
  utimesSync(join(dir, "old.ck3"), new Date(1000), new Date(1000));
  utimesSync(join(dir, "vanished.ck3"), new Date(9000), new Date(9000));
  statFails.add("vanished.ck3");
  try {
    const ref = await new SaveFileSource({ saveDir: dir }).latest();
    expect(ref?.path.endsWith("old.ck3")).toBe(true);
  } finally {
    statFails.clear();
  }
});

test("latest() returns null when every save fails to stat", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-"));
  writeFileSync(join(dir, "gone.ck3"), "a");
  statFails.add("gone.ck3");
  try {
    expect(await new SaveFileSource({ saveDir: dir }).latest()).toBeNull();
  } finally {
    statFails.clear();
  }
});
