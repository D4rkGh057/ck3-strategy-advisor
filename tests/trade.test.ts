import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractTrade } from "../src/extract/trade.js";

// Player 1 holds county 11 (market 100 sits on it). Route 0 is the player's, route 1 belongs to 2
// and crosses market 100, route 2 belongs to 2 and crosses only market 101 (not the realm).
const LANDED = `
date=1066.6.1
played_character={ character=1 player=1 }
landed_titles={ landed_titles={
  11={ key="c_ours" holder=1 }
  12={ key="c_other" holder=2 }
  21={ key="b_ours" holder=1 }
  22={ key="b_other" holder=2 }
} }
living={
1={ first_name="Ruler" landed_data={ domain={ 11 } trade_competitiveness=7 } }
2={ first_name="Rival" landed_data={ domain={ 12 } } }
3={ first_name="Caravaner" }
}
trade_markets={ database={
  100={ location=21 titles={ 11 } trade_routes={ 0 1 } }
  101={ location=22 titles={ 12 } trade_routes={ 2 } }
} }
trade_routes={ database={
  0={ owner=1 mode=profit primary_good=trade_good_salt gold=2.5 trade_markets={ 100 101 }
      trader={ character=3 task=oversee_caravans } transactions={ type=buy } transactions={ type=sell } }
  1={ owner=2 mode=distribution trade_markets={ 100 } gold=0.5 idle_months=3 }
  2={ owner=2 mode=profit trade_markets={ 101 } gold=9 }
} }
`;

const CATS = ["trade_category_cereals", "trade_category_clothes", "trade_category_salt"];
const run = async (gs: string, cats: string[] | null = null) =>
  (await queryGamestate(Buffer.from(gs), (q) => extractTrade(q, new Localizer(null), cats)))!;

test("lists the player's own routes with market, trader and transactions", async () => {
  const info = await run(LANDED);
  expect(info.own).toHaveLength(1);
  const r = info.own[0]!;
  expect(r).toMatchObject({
    id: 0,
    mode: "profit",
    gold: 2.5,
    transactions: 2,
    primaryGood: "salt",
  });
  expect(r.markets.map((m) => m.id)).toEqual([100, 101]);
  expect(r.trader).toEqual({ id: 3, name: "Caravaner" });
  expect(info.competitiveness).toBe(7);
  expect(info.worldRoutes).toBe(3);
});

test("realm routes are other owners' routes crossing a market with a county you hold", async () => {
  const info = await run(LANDED);
  expect(info.landless).toBe(false);
  expect(info.realmMarkets).toBe(1);
  expect(info.realm.map((r) => r.id)).toEqual([1]);
  expect(info.realm[0]).toMatchObject({ ownerId: 2, owner: "Rival", idleMonths: 3 });
});

test("a landless merchant gets owned routes only and is flagged landless", async () => {
  const gs = LANDED.replace('11={ key="c_ours" holder=1 }', '11={ key="x_c_merchant_1" holder=1 }');
  const info = await run(gs);
  expect(info.landless).toBe(true);
  expect(info.own.map((r) => r.id)).toEqual([0]);
  expect(info.realm).toEqual([]);
});

test("returns null on a save without trade data", async () => {
  const gs = LANDED.replace(/trade_routes=\{ database=\{[\s\S]*$/, "");
  expect(
    await queryGamestate(Buffer.from(gs), (q) => extractTrade(q, new Localizer(null))),
  ).toBeNull();
});

// Company title 11 stores XP per category in the game's category order (cereals, clothes, salt).
const WITH_XP = LANDED.replace(
  '11={ key="c_ours" holder=1 }',
  '11={ key="c_ours" holder=1 company_progression={ category_xp={ 0 1679.25 40 } } }',
).replace(
  "trader={ character=3",
  "transactions={ trade_market=100 trade_good=trade_good_salt type=sell amount=1 fulfilled_category=trade_category_salt } trader={ character=3",
);

test("expertise level is floor(xp / 150), names follow the category order, empty categories are hidden", async () => {
  const info = await run(WITH_XP, CATS);
  expect(info.expertise).toEqual([
    {
      category: "trade_category_clothes",
      xp: 1679.25,
      level: 11,
      toNext: 1800 - 1679.25,
      decaying: true,
    },
    { category: "trade_category_salt", xp: 40, level: 0, toNext: 110, decaying: false },
  ]);
});

test("expertise is null without category names and when the XP array does not match them", async () => {
  expect((await run(WITH_XP, null)).expertise).toBeNull();
  expect((await run(WITH_XP, ["trade_category_cereals"])).expertise).toBeNull();
});
