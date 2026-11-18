import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { GameData } from "../src/gameData.js";
import { extractTradeSuggestions } from "../src/extract/tradeSuggestions.js";
import type { CategoryModel } from "../src/tradeGoods.js";

// Player 1 holds county 11 (inside market 100). Market 100 has unsold grain (surplus 50, export 10)
// and needs salt (need 30, import 5). Market 101 needs grain 25 and sells salt 20. Market 102 needs
// grain 100 but is already linked to 100 by the player's route 0. Market 103 is far away.
const bal = (v: Record<string, number>) =>
  `{ ${Object.entries(v)
    .map(([k, n]) => `${k}=${n}`)
    .join(" ")} }`;
const GS = `
date=1066.6.1
played_character={ character=1 player=1 }
landed_titles={ landed_titles={
  11={ key="c_ours" holder=1 }
  21={ key="b_a" holder=1 }
  22={ key="b_b" holder=2 }
  23={ key="b_c" holder=2 }
  24={ key="b_d" holder=2 }
} }
living={ 1={ first_name="Ruler" landed_data={ domain={ 11 } } } }
trade_markets={ database={
  100={ location=21 duchy=1 titles={ 11 } trade_routes={ 0 }
    good_balances={ 0=${bal({ surplus: 50, export: 10, need: 0, import: 0 })} 1=${bal({ surplus: 0, export: 0, need: 30, import: 5 })} } }
  101={ location=22 duchy=2 titles={ 12 } trade_routes={ }
    good_balances={ 0=${bal({ surplus: 0, export: 0, need: 25, import: 0 })} 1=${bal({ surplus: 20, export: 0, need: 0, import: 0 })} } }
  102={ location=23 duchy=3 titles={ 13 } trade_routes={ 0 }
    good_balances={ 0=${bal({ surplus: 0, export: 0, need: 100, import: 0 })} } }
  103={ location=24 duchy=4 titles={ 14 } trade_routes={ }
    good_balances={ 0=${bal({ surplus: 0, export: 0, need: 100, import: 0 })} 1=${bal({ surplus: 90, export: 0, need: 0, import: 0 })} } }
} }
trade_routes={ database={
  0={ owner=1 mode=profit trade_markets={ 100 102 } path={ 1 5 3 }
      transactions={ trade_market=100 trade_good=trade_good_grain type=buy amount=1 price_per_unit=0.1 }
      transactions={ trade_market=100 trade_good=trade_good_salt type=sell amount=1 price_per_unit=0.2 } }
} }
`;
const GOODS = ["trade_good_grain", "trade_good_salt"];
const run = async (
  goods: string[] | null = GOODS,
  game = new GameData(null),
  loc = new Localizer(null),
) => (await queryGamestate(Buffer.from(GS), (q) => extractTradeSuggestions(q, loc, game, goods)))!;

test("pairs unsold surplus with unmet need, valued at the average transaction price", async () => {
  const info = await run();
  const s = info.suggestions.find((x) => x.other.id === 101)!;
  // out: min(50-10 grain, need 25) = 25 at 0.1; in: min(sell 20 salt, need 30-5=25) = 20 at 0.2.
  expect(s.flows).toEqual([
    { good: "trade_good_salt", amount: 20, direction: "in" },
    { good: "trade_good_grain", amount: 25, direction: "out" },
  ]);
  expect(s.score).toBeCloseTo(20 * 0.2 + 25 * 0.1, 6);
});

test("anchors are the realm market and the markets of own routes; linked pairs are skipped", async () => {
  const info = await run();
  expect(info.anchors.map((m) => m.id).sort()).toEqual([100, 102]);
  expect(info.suggestions.some((x) => x.anchor.id === 100 && x.other.id === 102)).toBe(false);
  expect(info.suggestions[0]!.score).toBeGreaterThanOrEqual(info.suggestions.at(-1)!.score);
});

test("refuses to name goods without the game's trade good list", async () => {
  const info = await run(null);
  expect(info.goodsAvailable).toBe(false);
  expect(info.suggestions).toEqual([]);
});

test("candidates farther than the reach seen in existing routes are dropped", async () => {
  const game = new GameData(null);
  game.baronyProvince.set("b_a", 1);
  game.baronyProvince.set("b_b", 2);
  game.baronyProvince.set("b_c", 3);
  game.baronyProvince.set("b_d", 4);
  const pos: Record<string, number> = { "1-3": 10, "1-2": 5, "1-4": 500 };
  const loc = Object.assign(new Localizer(null), {
    distance: (a: number, b: number) => pos[`${Math.min(a, b)}-${Math.max(a, b)}`] ?? null,
  });
  const info = await run(GOODS, game, loc);
  // Own route 100 <-> 102: 2 hops over distance 10, so 2 hops per 10 and a limit of 2 hops = 10.
  expect(info.routeLength).toEqual({ maxHops: 2, basis: "own", hopsPerDistance: 0.2 });
  expect(info.reach).toBeCloseTo(10, 6);
  expect(info.suggestions.map((x) => x.other.id)).toEqual([101]);
});

const geo = () => {
  const game = new GameData(null);
  game.baronyProvince.set("b_a", 1);
  game.baronyProvince.set("b_b", 2);
  game.baronyProvince.set("b_c", 3);
  game.baronyProvince.set("b_d", 4);
  const pos: Record<string, number> = { "1-3": 10, "1-2": 50, "1-4": 5 };
  const loc = Object.assign(new Localizer(null), {
    distance: (a: number, b: number) => pos[`${Math.min(a, b)}-${Math.max(a, b)}`] ?? null,
  });
  return { game, loc };
};

test("another owner's longer routes do not widen your route length", async () => {
  // Owner 2 runs a 20-hop route; it still must not raise the limit above your own 2 hops.
  const gs = GS.replace(
    "  0={ owner=1 mode=profit",
    "  1={ owner=2 mode=profit trade_markets={ 101 103 } path={ 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 } }\n  0={ owner=1 mode=profit",
  );
  const { game, loc } = geo();
  const info = (await queryGamestate(Buffer.from(gs), (q) =>
    extractTradeSuggestions(q, loc, game, GOODS),
  ))!;
  expect(info.routeLength.maxHops).toBe(2);
  expect(info.routeLength.basis).toBe("own");
});

test("without a route of your own the game's base length applies, calibrated on other routes", async () => {
  const gs = GS.replace("owner=1 mode=profit trade_markets={ 100 102 }", "owner=2 mode=profit trade_markets={ 100 102 }");
  const { game, loc } = geo();
  const info = (await queryGamestate(Buffer.from(gs), (q) =>
    extractTradeSuggestions(q, loc, game, GOODS),
  ))!;
  expect(info.routeLength).toEqual({ maxHops: 10, basis: "base", hopsPerDistance: 0.2 });
  expect(info.reach).toBeCloseTo(50, 6);
});

// Category data: "staples" covers grain and pays +10% per level when selling; expertise XP sits on
// the company title in category order [staples, minerals]. 450 XP at 150 per level = level 3.
const CATS: CategoryModel = {
  order: ["trade_category_staples", "trade_category_minerals"],
  defs: new Map([
    ["trade_category_staples", { goods: ["trade_good_grain"], sellPerLevel: 0.1, buyPerLevel: 0 }],
    ["trade_category_minerals", { goods: ["trade_good_salt"], sellPerLevel: 0, buyPerLevel: 0 }],
  ]),
};
const runXp = async (gs: string, cats: CategoryModel | null) =>
  (await queryGamestate(Buffer.from(gs), (q) =>
    extractTradeSuggestions(q, new Localizer(null), new GameData(null), GOODS, cats, 150),
  ))!;
const XP_GS = GS.replace(
  '11={ key="c_ours" holder=1 }',
  '11={ key="c_ours" holder=1 company_progression={ category_xp={ 450 0 } } }',
);

test("expertise raises the value of sales in a category by the per-level modifier and tags the pair", async () => {
  const plain = (await runXp(XP_GS, null)).suggestions.find((x) => x.other.id === 101)!;
  const info = await runXp(XP_GS, CATS);
  const s = info.suggestions.find((x) => x.other.id === 101)!;
  expect(info.expertiseApplied).toBe(true);
  // out grain 25 at 0.1 gets x(1 + 3 x 0.1) = x1.3; in salt 20 at 0.2 has no modifier.
  expect(s.score).toBeCloseTo(plain.score + 25 * 0.1 * 0.3, 6);
  // No route of the player fulfils the staples category, so it is flagged as decaying.
  expect(s.xpCategories).toEqual([
    { category: "trade_category_staples", level: 3, decaying: true, goods: ["trade_good_grain"] },
  ]);
});

test("without category data or a matching XP array the scores are the plain ones", async () => {
  const plain = await runXp(GS, null);
  expect(plain.expertiseApplied).toBe(false);
  const mismatch = await runXp(XP_GS, { ...CATS, order: ["trade_category_staples"] });
  expect(mismatch.expertiseApplied).toBe(false);
  expect(mismatch.suggestions.map((x) => x.score)).toEqual(plain.suggestions.map((x) => x.score));
  expect(mismatch.suggestions.every((x) => x.xpCategories.length === 0)).toBe(true);
});

test("with a known reach, a pair whose distance is unknown is dropped", async () => {
  const game = new GameData(null);
  game.baronyProvince.set("b_a", 1);
  game.baronyProvince.set("b_b", 2);
  game.baronyProvince.set("b_c", 3); // b_d is deliberately unmapped: market 103 has no distance
  const pos: Record<string, number> = { "1-3": 10, "1-2": 5 };
  const loc = Object.assign(new Localizer(null), {
    distance: (a: number, b: number) => pos[`${Math.min(a, b)}-${Math.max(a, b)}`] ?? null,
  });
  const info = await run(GOODS, game, loc);
  expect(info.reach).toBe(10);
  expect(info.suggestions.map((x) => x.other.id)).toEqual([101]);
});
