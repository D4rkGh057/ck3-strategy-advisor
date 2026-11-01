import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "../src/snapshot.js";
import { Localizer } from "../src/localization.js";
import { HistoryStore, entryFromSnapshot, renderHistory } from "../src/history.js";

const GS = readFileSync(fileURLToPath(new URL("./fixtures/mini-gamestate.txt", import.meta.url)));
const ID = "009c045a-2d8b-4490-b153-3517ecf30c07";

async function snap() {
  return buildSnapshot(GS, new Localizer(null));
}

test("snapshot exposes playthrough id and timer", async () => {
  const s = await snap();
  expect(s.playthrough).toEqual({ id: ID, timer: 56800 });
});

test("entryFromSnapshot keeps only the small set of trend fields", async () => {
  const e = entryFromSnapshot(await snap());
  expect(e).toMatchObject({ timer: 56800, date: "1130.7.24", ruler: "Emperor Jenec", gold: 124.5 });
  expect(Object.keys(e).sort()).toEqual(
    ["date", "gold", "holdings", "income", "levy", "piety", "prestige", "ruler", "strength", "timer", "titles", "vassals"].sort(),
  );
});

test("record writes one file per playthrough and dedupes by timer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-hist-"));
  const store = new HistoryStore(dir);
  const s = await snap();
  await store.record(s);
  await store.record(s);
  expect(readdirSync(dir)).toEqual([`${ID}.json`]);
  expect((await store.read(ID)).length).toBe(1);
  await store.record({ ...s, playthrough: { id: ID, timer: 100 } });
  const all = await store.read(ID);
  expect(all.map((e) => e.timer)).toEqual([100, 56800]); // ordered by timer
});

test("record is a no-op without a playthrough id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-hist-"));
  const s = await snap();
  await new HistoryStore(dir).record({ ...s, playthrough: { id: null, timer: null } });
  expect(readdirSync(dir)).toEqual([]);
});

test("a corrupt history file reads as empty and is replaced on the next record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-hist-"));
  writeFileSync(join(dir, `${ID}.json`), "{not json");
  const store = new HistoryStore(dir);
  expect(await store.read(ID)).toEqual([]);
  await store.record(await snap());
  expect((await store.read(ID)).length).toBe(1);
});

test("renderHistory shows a table with first-to-last deltas", async () => {
  const s = await snap();
  const a = entryFromSnapshot(s);
  const b = { ...a, timer: 60000, date: "1135.1.1", gold: 200 };
  const out = renderHistory([a, b], 20);
  expect(out).toContain("1130.7.24");
  expect(out).toContain("1135.1.1");
  expect(out).toContain("+75.5"); // gold delta
});

test("renderHistory down-samples to the limit keeping first and last", async () => {
  const a = entryFromSnapshot(await snap());
  const many = Array.from({ length: 50 }, (_, i) => ({ ...a, timer: i, date: `d${i}` }));
  const out = renderHistory(many, 5);
  expect(out).toContain("d0");
  expect(out).toContain("d49");
  expect(out).toContain("Showing 5 of 50");
});
