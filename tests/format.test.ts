import { expect, test } from "vitest";
import { stamp } from "../src/format.js";

test("stamp output is unchanged for a normal snapshot", () => {
  const out = stamp({ date: "1066.9.15", parsedAt: Date.now() }, "body");
  expect(out).toBe("_Snapshot: 1066.9.15 (read just now)_\n\nbody");
});

test("stamp says a newer save could not be read only when the snapshot is flagged", () => {
  const snap = { date: "1066.9.15", parsedAt: Date.now(), newerSaveUnreadable: true };
  const out = stamp(snap, "body");
  expect(out).toContain("serving an older save");
  expect(out).toContain("newest save could not be read yet");
  expect(out.endsWith("\n\nbody")).toBe(true);
  expect(stamp({ ...snap, newerSaveUnreadable: false }, "body")).not.toContain("older save");
});
