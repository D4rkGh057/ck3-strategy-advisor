import { describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SaveFileSource } from "../src/source.js";
import { SnapshotCache } from "../src/cache.js";
import { Localizer } from "../src/localization.js";
import { registerAllTools } from "../src/tools/index.js";
import { makeTextEnvelope } from "./fixtures/make-envelope.js";

// Shape of a real 1.21 landless-merchant save: no levy, strength, vassal limit or legitimacy.
const gamestate = (government: string) => `
date=1066.9.15
played_character={ character=7 player=1 }
landed_titles={ landed_titles={ } }
living={
7={
	first_name="Anastasio"
	alive_data={ gold={ value=50 } }
	landed_data={ government="${government}" domain_limit=5 }
}
}
`;

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;

async function call(tool: string, government: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "ck3-merchant-"));
  writeFileSync(join(dir, "game.ck3"), makeTextEnvelope(gamestate(government)));
  const cache = new SnapshotCache(new SaveFileSource({ saveDir: dir }), new Localizer(null));
  const handlers = new Map<string, Handler>();
  registerAllTools(
    { registerTool: (name: string, _c: unknown, h: Handler) => void handlers.set(name, h) } as any,
    cache,
  );
  return (await handlers.get(tool)!({})).content[0]!.text;
}

describe("merchant company shows n/a instead of ?", () => {
  test("realm_overview", async () => {
    const text = await call("realm_overview", "merchant_government");
    expect(text).toContain("Legitimacy: n/a (merchant company)");
    expect(text).toContain("Vassals: n/a (merchant company)");
    expect(text).not.toContain("?/?");
  });

  test("military", async () => {
    const text = await call("military", "merchant_government");
    expect(text).toContain("Levy: n/a | Total strength: n/a (current n/a)");
    expect(text).toContain("Merchant company: no levy or standing strength");
  });

  test("another government keeps the ? so a moved path stays visible", async () => {
    const overview = await call("realm_overview", "feudal_government");
    expect(overview).toContain("Legitimacy: ?");
    expect(overview).toContain("Vassals counting toward limit: ?/?");
    const military = await call("military", "feudal_government");
    expect(military).toContain("Levy: ? | Total strength: ? (current ?)");
    expect(military).not.toContain("n/a");
  });
});
