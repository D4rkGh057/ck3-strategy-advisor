import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractMarkets } from "../src/extract/markets.js";
import { line } from "../src/tools/markets.js";

// Player 1 holds county 11 (market 100). Market 101 is crossed by the player's route 0. Market 102 is
// foreign and unrelated. Goods: 0 grain, 1 salt.
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
    good_balances={ 0=${bal({ surplus: 50, export: 10, need: 0, import: 0 })} 1=${bal({ surplus: 0, export: 0, need: 30, import: 5 })} } }
  101={ location=22 duchy=2 titles={ 12 } trade_routes={ 0 1 }
    good_balances={ 0=${bal({ surplus: 0, export: 0, need: 25, import: 0 })} 1=${bal({ surplus: 0.2, export: 0, need: 0, import: 0 })} } }
  102={ location=23 duchy=3 titles={ 13 } trade_routes={ }
    good_balances={ 0=${bal({ surplus: 99, export: 0, need: 0, import: 0 })} } }
} }
trade_routes={ database={
  0={ owner=1 mode=profit trade_markets={ 100 101 } }
  1={ owner=2 mode=profit trade_markets={ 101 } }
} }
`;
const GOODS = ["trade_good_grain", "trade_good_salt"];
const run = async (goods: string[] | null = GOODS) =>
  (await queryGamestate(Buffer.from(GS), (q) => extractMarkets(q, new Localizer(null), goods)))!;

test("lists realm and own-route markets, not foreign ones", async () => {
  const info = await run();
  expect(info.markets.map((m) => m.id)).toEqual([100, 101]);
  expect(info.markets[0]!.links).toEqual(["realm", "own route"]);
  expect(info.markets[1]!.links).toEqual(["own route"]);
});

test("reads surplus as surplus - export and need as need - import, dropping crumbs", async () => {
  const [m100, m101] = (await run()).markets;
  expect(m100!.surplus).toEqual([{ good: "trade_good_grain", amount: 40 }]);
  expect(m100!.deficit).toEqual([{ good: "trade_good_salt", amount: 25 }]);
  expect(m101!.surplus).toEqual([]);
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
    "- b_a (100) [realm, own route] — 1 route(s) (1 yours); unsold surplus: grain 40; unmet need: salt 25",
  );
});
