import { expect, test } from "vitest";
import { mkdtempSync, writeFileSync, utimesSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SaveFileSource } from "../src/source.js";
import { SnapshotCache } from "../src/cache.js";
import { Localizer } from "../src/localization.js";
import { makeTextEnvelope } from "./fixtures/make-envelope.js";

const GS = readFileSync(
  fileURLToPath(new URL("./fixtures/mini-gamestate.txt", import.meta.url)),
  "utf8",
);

test("cache builds once, then serves until mtime changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-"));
  const file = join(dir, "game.ck3");
  writeFileSync(file, makeTextEnvelope(GS));
  utimesSync(file, new Date(1000), new Date(1000));
  const cache = new SnapshotCache(new SaveFileSource({ saveDir: dir }), new Localizer(null));
  const a = await cache.get();
  const b = await cache.get();
  expect("overview" in a && a.overview.rulerName).toBe("Emperor Jenec");
  expect(a).toBe(b); // same cached object, no re-parse
});

test("cache reports an error when no save exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-"));
  const cache = new SnapshotCache(new SaveFileSource({ saveDir: dir }), new Localizer(null));
  expect("error" in (await cache.get())).toBe(true);
});

test("concurrent cold-cache gets coalesce into a single build (same object reference)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-"));
  const file = join(dir, "game.ck3");
  writeFileSync(file, makeTextEnvelope(GS));
  utimesSync(file, new Date(1000), new Date(1000));
  const cache = new SnapshotCache(new SaveFileSource({ saveDir: dir }), new Localizer(null));
  const [a, b, c] = await Promise.all([cache.get(), cache.get(), cache.get()]);
  expect(a === b && b === c).toBe(true); // single build shared across all three callers
});

function memoCache(mtime: number) {
  const dir = mkdtempSync(join(tmpdir(), "ck3-"));
  const file = join(dir, "game.ck3");
  writeFileSync(file, makeTextEnvelope(GS));
  utimesSync(file, new Date(mtime), new Date(mtime));
  const cache = new SnapshotCache(new SaveFileSource({ saveDir: dir }), new Localizer(null));
  return { cache, file };
}

test("memoQuery runs the extractor once per key, shares concurrent callers, and keys apart", async () => {
  const { cache } = memoCache(1000);
  let runs = 0;
  const fn = () => ({ n: ++runs });
  const [a, b] = await Promise.all([cache.memoQuery("k", fn), cache.memoQuery("k", fn)]);
  const c = await cache.memoQuery("k", fn);
  expect(a).toBe(b);
  expect(c).toBe(a);
  expect(runs).toBe(1);
  await cache.memoQuery("other", fn);
  expect(runs).toBe(2);
});

test("memoQuery results are dropped when a newer save is read", async () => {
  const { cache, file } = memoCache(1000);
  let runs = 0;
  const fn = () => ({ n: ++runs });
  const first = await cache.memoQuery("k", fn);
  utimesSync(file, new Date(2000), new Date(2000));
  const second = await cache.memoQuery("k", fn);
  expect(runs).toBe(2);
  expect(second).not.toBe(first);
});

test("the shared store is the same across queries of one save and fresh for a newer save", async () => {
  const { cache, file } = memoCache(1000);
  const first = await cache.query((_q, shared) => shared);
  const again = await cache.memoQuery("other", (_q, shared) => ({ shared }));
  expect((again as { shared: object }).shared).toBe(first);
  utimesSync(file, new Date(2000), new Date(2000));
  const next = await cache.query((_q, shared) => shared);
  expect(next).not.toBe(first);
});

test("memoQuery does not keep a failed run", async () => {
  const { cache } = memoCache(1000);
  let runs = 0;
  const boom = () => {
    runs++;
    throw new Error("boom");
  };
  await expect(cache.memoQuery("k", boom)).rejects.toThrow("boom");
  await expect(cache.memoQuery("k", boom)).rejects.toThrow("boom");
  expect(runs).toBe(2);
});

test("memoQuery surfaces a missing save as { error } without caching it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-"));
  const cache = new SnapshotCache(new SaveFileSource({ saveDir: dir }), new Localizer(null));
  expect("error" in ((await cache.memoQuery("k", () => 1)) as object)).toBe(true);
});

test("cache records each built save into the history store without failing the get", async () => {
  const { HistoryStore } = await import("../src/history.js");
  const dir = mkdtempSync(join(tmpdir(), "ck3-"));
  const hist = mkdtempSync(join(tmpdir(), "ck3-hist-"));
  writeFileSync(join(dir, "game.ck3"), makeTextEnvelope(GS));
  const store = new HistoryStore(hist);
  const cache = new SnapshotCache(
    new SaveFileSource({ saveDir: dir }),
    new Localizer(null),
    undefined,
    store,
  );
  const snap = await cache.get();
  expect("error" in snap).toBe(false);
  await cache.history!.record(snap as never); // same timer: idempotent, also awaits the write
  expect((await store.read("009c045a-2d8b-4490-b153-3517ecf30c07")).length).toBe(1);
});

test("a failing history store never breaks the cache", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-"));
  writeFileSync(join(dir, "game.ck3"), makeTextEnvelope(GS));
  const broken = { record: () => Promise.reject(new Error("disk full")) } as never;
  const cache = new SnapshotCache(new SaveFileSource({ saveDir: dir }), new Localizer(null), undefined, broken);
  expect("error" in (await cache.get())).toBe(false);
});
