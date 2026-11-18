import { expect, test } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SaveFileSource } from "../src/source.js";
import { SnapshotCache } from "../src/cache.js";
import { Localizer } from "../src/localization.js";
import { registerAllTools } from "../src/tools/index.js";
import { makeTextEnvelope } from "./fixtures/make-envelope.js";

const GS = readFileSync(
  fileURLToPath(new URL("./fixtures/mini-gamestate.txt", import.meta.url)),
  "utf8",
);

function setup(saveDir: string) {
  const cache = new SnapshotCache(new SaveFileSource({ saveDir }), new Localizer(null));
  cache.loc.decodeNames = (s: string) => s.replace(/Jenec/g, "DECODED");
  const handlers = new Map<string, (a: unknown) => Promise<any>>();
  const registerTool = (name: string, _c: unknown, h: (a: unknown) => Promise<any>) =>
    void handlers.set(name, h);
  const server = { registerTool } as any;
  registerAllTools(server, cache);
  return { handlers, server, registerTool };
}

test("every tool reply is passed through decodeNames, errors included", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-decode-"));
  writeFileSync(join(dir, "game.ck3"), makeTextEnvelope(GS));
  const { handlers } = setup(dir);
  const text = (await handlers.get("realm_overview")!({})).content[0].text as string;
  expect(text).toContain("DECODED");
  expect(text).not.toContain("Jenec");

  const empty = setup(mkdtempSync(join(tmpdir(), "ck3-decode-")));
  const err = await empty.handlers.get("realm_overview")!({});
  expect(err.isError).toBe(true);
});

test("registering the tools leaves the real server untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "ck3-decode-"));
  const { server, registerTool } = setup(dir);
  expect(server.registerTool).toBe(registerTool);
});
