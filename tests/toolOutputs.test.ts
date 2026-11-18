import { describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SaveFileSource } from "../src/source.js";
import { SnapshotCache } from "../src/cache.js";
import { Localizer } from "../src/localization.js";
import { registerAllTools } from "../src/tools/index.js";
import { makeTextEnvelope } from "./fixtures/make-envelope.js";

// Characterization test: pins the exact text every registered tool returns, for a healthy save and
// for a missing one. It exists so tool plumbing can be refactored without changing any output.

const GS = readFileSync(
  fileURLToPath(new URL("./fixtures/mini-gamestate.txt", import.meta.url)),
  "utf8",
);

// Arguments for the tools that take input; every other tool is called with {}.
const ARGS: Record<string, Record<string, unknown>> = {
  find_character: { name: "Jenec" },
  character: { id: 1 },
  foreign_realm: { name: "Jenec" },
  game_search: { query: "claim" },
  game_entry: { category: "trait", key: "brave" },
};

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

function collect(cache: SnapshotCache): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _cfg: unknown, h: Handler) => void handlers.set(name, h),
  } as any;
  registerAllTools(server, cache);
  return handlers;
}

// The snapshot stamp carries a wall-clock age.
const normalize = (v: unknown) =>
  JSON.parse(JSON.stringify(v).replace(/read [^)]*\)/g, "read AGE)"));

async function runAll(cache: SnapshotCache) {
  const out: Record<string, unknown> = {};
  const handlers = collect(cache);
  for (const name of [...handlers.keys()].sort()) {
    try {
      out[name] = normalize(await handlers.get(name)!(ARGS[name] ?? {}));
    } catch (e) {
      out[name] = `THROWS: ${(e as Error).message}`;
    }
  }
  return out;
}

describe("tool outputs", () => {
  test("with a readable save", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ck3-tools-"));
    writeFileSync(join(dir, "game.ck3"), makeTextEnvelope(GS));
    const cache = new SnapshotCache(new SaveFileSource({ saveDir: dir }), new Localizer(null));
    expect(await runAll(cache)).toMatchSnapshot();
  });

  test("with no save", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ck3-tools-"));
    const cache = new SnapshotCache(new SaveFileSource({ saveDir: dir }), new Localizer(null));
    expect(await runAll(cache)).toMatchSnapshot();
  });
});
