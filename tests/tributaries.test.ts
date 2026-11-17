import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { collectTributaries, findOverlord } from "../src/extract/tributaries.js";
import { extractForeignRealm } from "../src/extract/foreignRealm.js";

const GS = readFileSync(fileURLToPath(new URL("./fixtures/mini-gamestate.txt", import.meta.url)));
const loc = new Localizer(null);

describe("tributaries", () => {
  it("lists a liege's tributaries and ignores its ordinary vassals", async () => {
    // 40001 (Philippe) holds a tributary contract (5002) and a tribal_vassal contract (5003).
    const t = await queryGamestate(GS, (q) => collectTributaries(q, loc, 40001));
    expect(t).toEqual([{ id: 40000, name: "Causantin" }]);
  });

  it("finds the overlord of a tributary", async () => {
    const o = await queryGamestate(GS, (q) => findOverlord(q, loc, 40000));
    expect(o).toEqual({ id: 40001, name: "Philippe" });
  });

  it("does not treat an ordinary vassal as a tributary", async () => {
    const o = await queryGamestate(GS, (q) => findOverlord(q, loc, 40002));
    expect(o).toBeNull();
  });

  it("returns nothing for a ruler without tributaries or an overlord", async () => {
    expect(await queryGamestate(GS, (q) => collectTributaries(q, loc, 40002))).toEqual([]);
    expect(await queryGamestate(GS, (q) => findOverlord(q, loc, 40001))).toBeNull();
  });

  it("foreign_realm reports both directions", async () => {
    const alba = await queryGamestate(GS, (q) => extractForeignRealm(q, loc, "Alba"));
    expect(alba!.tributaryOf).toEqual({ id: 40001, name: "Philippe" });
    expect(alba!.tributaries).toEqual([]);
    const france = await queryGamestate(GS, (q) => extractForeignRealm(q, loc, "k_france"));
    expect(france!.tributaryOf).toBeNull();
    expect(france!.tributaries).toEqual([{ id: 40000, name: "Causantin" }]);
  });
});
