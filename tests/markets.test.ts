import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractMarkets } from "../src/extract/markets.js";
import { line } from "../src/tools/markets.js";

// Player 1 holds county 11 (market 100). Market 101 is crossed by the player's route 0. Market 102 is
// foreign and unrelated. Goods: 0 grain, 1 salt, 2 wine.
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
} }
living={ 1={ first_name="Ruler" landed_data={ domain={ 11 } } } }
trade_markets={ database={
  100={ location=21 duchy=1 titles={ 11 } trade_routes={ 0 }
    good_balances={ 0=${bal({ surplus: 50, export: 10, need: 0, import: 0 })} 1=${bal({ surplus: 0, export: 0, need: 30, import: 5, distribution_import: 5 })} } }
  101={ location=22 duchy=2 titles={ 12 } trade_routes={ 0 1 }
    good_balances={ 0=${bal({ surplus: 0, export: 0, need: 25, import: 0 })} 1=${bal({ surplus: 0.2, export: 0, need: 0, import: 0 })} 2=${bal({ surplus: 40, export: 5, import_only_need: 15, need: 0, import: 0 })} } }
  102={ location=23 duchy=3 titles={ 13 } trade_routes={ }
    good_balances={ 0=${bal({ surplus: 99, export: 0, need: 0, import: 0 })} } }
} }
trade_routes={ database={
  0={ owner=1 mode=profit trade_markets={ 100 101 } }
  1={ owner=2 mode=profit trade_markets={ 101 } }
} }
`;
const GOODS = ["trade_good_grain", "trade_good_salt", "trade_good_wine"];
const run = async (goods: string[] | null = GOODS) =>
  (await queryGamestate(Buffer.from(GS), (q) => extractMarkets(q, new Localizer(null), goods)))!;

test("lists realm and own-route markets, not foreign ones", async () => {
  const info = await run();
  expect(info.markets.map((m) => m.id)).toEqual([100, 101]);
  expect(info.markets[0]!.links).toEqual(["realm", "own route"]);
  expect(info.markets[1]!.links).toEqual(["own route"]);
});

test("reads surplus as surplus - hub need and need as need - distribution import, dropping crumbs", async () => {
  const [m100, m101] = (await run()).markets;
  // Export is not subtracted (grain 50 stays 50); plain import is not either, only distribution_import (30 - 5).
  expect(m100!.surplus).toEqual([{ good: "trade_good_grain", amount: 50 }]);
  expect(m100!.deficit).toEqual([{ good: "trade_good_salt", amount: 25 }]);
  // Index 2 (a third good): 40 surplus - 15 hub need = 25, with export 5 ignored; 0.2 salt is a crumb.
  expect(m101!.surplus).toEqual([{ good: "trade_good_wine", amount: 25 }]);
  expect(m101!.deficit).toEqual([{ good: "trade_good_grain", amount: 25 }]);
});

test("counts every route and the ones that are yours", async () => {
  const [m100, m101] = (await run()).markets;
  expect([m100!.routes, m100!.ownRoutes]).toEqual([1, 1]);
  expect([m101!.routes, m101!.ownRoutes]).toEqual([2, 1]);
});

test("refuses to name goods without the game's good list", async () => {
  expect(await run(null)).toEqual({ goodsAvailable: false, markets: [] });
});

test("returns null on a save without trade data", async () => {
  const info = await queryGamestate(
    Buffer.from("date=1066.6.1\nplayed_character={ character=1 }"),
    (q) => extractMarkets(q, new Localizer(null), GOODS),
  );
  expect(info).toBeNull();
});

test("renders one line per market", async () => {
  const [m100] = (await run()).markets;
  const out = line({ loc: { resolve: (k: string) => k } } as any, m100!);
  expect(out).toBe(
    "- b_a (100) [realm, own route] — 1 route(s) (1 yours); unsold surplus: grain 50; unmet need: salt 25",
  );
});

test("subtracts what distribution routes buy at the market from its surplus, not the aggregate export", async () => {
  // A distribution route buys 15 grain at market 100 (surplus 50): 35 remains. A profit route doing
  // the same would not count, and neither does the plain `export` (10) on the balance.
  const gs = GS.replace(
    "titles={ 11 } trade_routes={ 0 }",
    "titles={ 11 } trade_routes={ 0 2 3 }",
  ).replace(
    "  1={ owner=2 mode=profit trade_markets={ 101 } }",
    `  1={ owner=2 mode=profit trade_markets={ 101 } }
  2={ owner=2 mode=distribution trade_markets={ 100 101 }
      transactions={ trade_market=100 trade_good=trade_good_grain type=buy amount=10 price_per_unit=0.1 }
      transactions={ trade_market=100 trade_good=trade_good_grain type=buy amount=5 price_per_unit=0.1 }
      transactions={ trade_market=101 trade_good=trade_good_grain type=sell amount=15 price_per_unit=0.1 } }
  3={ owner=2 mode=profit trade_markets={ 100 101 }
      transactions={ trade_market=100 trade_good=trade_good_grain type=buy amount=20 price_per_unit=0.1 } }`,
  );
  const info = (await queryGamestate(Buffer.from(gs), (q) =>
    extractMarkets(q, new Localizer(null), GOODS),
  ))!;
  expect(info.markets[0]!.surplus).toEqual([{ good: "trade_good_grain", amount: 35 }]);
});
