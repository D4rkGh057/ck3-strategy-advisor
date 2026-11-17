import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import type { GameData } from "../gameData.js";
import { idList, num, playerIdOf } from "./common.js";
import { fulfilledCategories, realmMarketIds } from "./trade.js";
import type { CategoryModel } from "../tradeGoods.js";
import { resolveTitleName } from "./titleUtils.js";

type Rec = Record<string, unknown>;

export interface MarketRef {
  id: number;
  place: string;
}

export interface Flow {
  good: string;
  /** Units the first market can still sell and the second still needs (the smaller of the two). */
  amount: number;
  /** `out` = the anchor sells to the other market; `in` = the anchor buys from it. */
  direction: "out" | "in";
}

export interface Suggestion {
  anchor: MarketRef;
  other: MarketRef;
  /** Sum of amount x reference price over the flows: a ranking score, not an income. */
  score: number;
  distance: number | null;
  flows: Flow[];
  /** Routes (any owner) that already cross both markets. */
  existingRoutes: number;
  /** Categories where you have expertise XP and this pair moves a good of that category. */
  xpCategories: { category: string; level: number; decaying: boolean; goods: string[] }[];
}

export interface TradeSuggestionsInfo {
  goodsAvailable: boolean;
  anchors: MarketRef[];
  /** 90th-percentile hop between two markets of an existing route: the only reach the save reveals. */
  reach: number | null;
  priceSamples: number;
  /** Expertise levels were applied to the scores (needs the category data and the XP array). */
  expertiseApplied: boolean;
  suggestions: Suggestion[];
}

const TOP = 15;

function flowTotals(r: Rec | undefined): { sell: number; want: number } {
  const surplus = num(r?.["surplus"]) ?? 0;
  const exported = num(r?.["export"]) ?? 0;
  const need = num(r?.["need"]) ?? 0;
  const imported = num(r?.["import"]) ?? 0;
  return { sell: Math.max(0, surplus - exported), want: Math.max(0, need - imported) };
}

/**
 * Ranks market pairs worth a new route: your anchor markets (markets of your realm, of your own
 * routes and of your capital) against every other market, by how much unsold surplus of one side
 * meets unmet need on the other, valued at the average price seen in route transactions.
 * The save does not say which pairs can be connected, nor route limits or costs, so candidates are
 * cut to the 90th-percentile hop that existing routes already make. When the category data is
 * available, flows in categories you hold expertise in are valued with the category's per-level
 * price modifiers, and each pair lists the categories where it would keep or grow your XP.
 */
export function extractTradeSuggestions(
  q: Query,
  loc: Localizer,
  game: GameData,
  goods: string[] | null,
  cats: CategoryModel | null = null,
  xpPerLevel = 150,
): TradeSuggestionsInfo | null {
  const markets = q.at("/trade_markets/database") as Record<string, Rec> | undefined;
  const routes = q.at("/trade_routes/database") as Record<string, Rec> | undefined;
  if (!markets || !routes) return null;
  if (!goods)
    return {
      goodsAvailable: false,
      anchors: [],
      reach: null,
      priceSamples: 0,
      expertiseApplied: false,
      suggestions: [],
    };

  const playerId = playerIdOf(q);
  const mk = (id: number): MarketRef => {
    const t = num(markets[String(id)]?.["location"]);
    return { id, place: t !== null ? resolveTitleName(q, loc, t) : "?" };
  };
  const provinceOf = (id: number): number | null => {
    const t = num(markets[String(id)]?.["location"]);
    const key = t !== null ? q.at(`/landed_titles/landed_titles/${t}/key`) : null;
    return typeof key === "string" ? (game.baronyProvince.get(key) ?? null) : null;
  };
  const dist = (a: number, b: number): number | null => {
    const pa = provinceOf(a);
    const pb = provinceOf(b);
    return pa !== null && pb !== null ? loc.distance(pa, pb) : null;
  };

  // Reference prices and the reach seen in existing routes.
  const sums = new Map<string, { total: number; n: number }>();
  const hops: number[] = [];
  const linked = new Set<string>();
  const ownMarkets = new Set<number>();
  const ownRouteIds: number[] = [];
  for (const [routeId, r] of Object.entries(routes)) {
    if (r["owner"] === playerId) ownRouteIds.push(Number(routeId));
    const txs = Array.isArray(r["transactions"])
      ? r["transactions"]
      : r["transactions"]
        ? [r["transactions"]]
        : [];
    for (const t of txs as Rec[]) {
      const p = num(t["price_per_unit"]);
      if (typeof t["trade_good"] !== "string" || p === null) continue;
      const s = sums.get(t["trade_good"]) ?? { total: 0, n: 0 };
      s.total += p;
      s.n++;
      sums.set(t["trade_good"], s);
    }
    const ms = idList(r["trade_markets"]);
    for (const a of ms)
      for (const b of ms) {
        if (a >= b) continue;
        if (r["owner"] === playerId) linked.add(`${a}-${b}`);
        const d = dist(a, b);
        if (d !== null) hops.push(d);
      }
    if (r["owner"] === playerId) ms.forEach((m) => ownMarkets.add(m));
  }
  hops.sort((a, b) => a - b);
  const reach = hops.length > 0 ? hops[Math.floor((hops.length - 1) * 0.9)]! : null;
  let totalP = 0;
  let totalN = 0;
  for (const s of sums.values()) {
    totalP += s.total;
    totalN += s.n;
  }
  const fallbackPrice = totalN > 0 ? totalP / totalN : 0;
  const price = (g: string): number => {
    const s = sums.get(g);
    return s ? s.total / s.n : fallbackPrice;
  };

  // Anchors: realm markets, markets of your routes, and the market of your capital's duchy.
  const anchorIds = new Set<number>([...realmMarketIds(q, playerId), ...ownMarkets]);
  const domain = idList(q.at(`/living/${playerId}/landed_data/domain`));
  const capital =
    domain[0] !== undefined ? num(q.at(`/landed_titles/landed_titles/${domain[0]}/capital`)) : null;
  const duchy =
    capital !== null ? num(q.at(`/landed_titles/landed_titles/${capital}/de_jure_liege`)) : null;
  if (duchy !== null)
    for (const [id, m] of Object.entries(markets))
      if (m["duchy"] === duchy) anchorIds.add(Number(id));

  // Expertise: XP per category in the game's category order, on the primary (company) title.
  const rawXp =
    cats && domain[0] !== undefined
      ? q.at(`/landed_titles/landed_titles/${domain[0]}/company_progression/category_xp`)
      : undefined;
  const expertiseApplied = !!cats && Array.isArray(rawXp) && rawXp.length === cats.order.length;
  const active = fulfilledCategories(routes, ownRouteIds);
  const levels = new Map<string, { level: number; decaying: boolean }>();
  if (cats && expertiseApplied)
    (rawXp as unknown[]).forEach((v, i) => {
      const xp = num(v);
      if (xp !== null && xp > 0) {
        const key = cats.order[i]!;
        levels.set(key, { level: Math.floor(xp / xpPerLevel), decaying: !active.has(key) });
      }
    });
  // A good can sit in several categories; each one you have XP in adds its per-level modifier.
  const goodCats = new Map<string, string[]>();
  if (cats)
    for (const [key, def] of cats.defs)
      if (levels.has(key))
        for (const g of def.goods) goodCats.set(g, [...(goodCats.get(g) ?? []), key]);
  const priceMult = (good: string, direction: "out" | "in"): number => {
    let m = 1;
    for (const key of goodCats.get(good) ?? []) {
      const def = cats!.defs.get(key)!;
      const lvl = levels.get(key)!.level;
      m += direction === "out" ? lvl * def.sellPerLevel : lvl * -def.buyPerLevel;
    }
    return m;
  };
  const worth = (f: Flow): number => f.amount * price(f.good) * priceMult(f.good, f.direction);

  const balance = (id: number, g: number): { sell: number; want: number } =>
    flowTotals(
      (markets[String(id)]?.["good_balances"] as Rec | undefined)?.[String(g)] as Rec | undefined,
    );

  const out: Suggestion[] = [];
  for (const a of anchorIds) {
    for (const [bStr, bm] of Object.entries(markets)) {
      const b = Number(bStr);
      if (b === a || (anchorIds.has(b) && b < a)) continue;
      if (linked.has(`${Math.min(a, b)}-${Math.max(a, b)}`)) continue;
      const distance = dist(a, b);
      // With a known reach, a pair whose distance is unknown cannot be vouched for either.
      if (reach !== null && (distance === null || distance > reach)) continue;
      const flows: Flow[] = [];
      for (let g = 0; g < goods.length; g++) {
        const A = balance(a, g);
        const B = balance(b, g);
        const outAmt = Math.min(A.sell, B.want);
        const inAmt = Math.min(B.sell, A.want);
        if (outAmt > 0) flows.push({ good: goods[g]!, amount: outAmt, direction: "out" });
        if (inAmt > 0) flows.push({ good: goods[g]!, amount: inAmt, direction: "in" });
      }
      if (flows.length === 0) continue;
      flows.sort((x, y) => worth(y) - worth(x));
      const score = flows.reduce((s, f) => s + worth(f), 0);
      const touched = new Map<string, Set<string>>();
      for (const f of flows)
        for (const key of goodCats.get(f.good) ?? [])
          touched.set(key, (touched.get(key) ?? new Set()).add(f.good));
      const sharedRoutes = new Set(idList(markets[String(a)]?.["trade_routes"]));
      out.push({
        anchor: mk(a),
        other: mk(b),
        score,
        distance,
        flows: flows.slice(0, 3),
        existingRoutes: idList(bm["trade_routes"]).filter((r) => sharedRoutes.has(r)).length,
        xpCategories: [...touched].map(([category, gs]) => ({
          category,
          ...levels.get(category)!,
          goods: [...gs],
        })),
      });
    }
  }
  out.sort((x, y) => y.score - x.score);
  return {
    goodsAvailable: true,
    anchors: [...anchorIds].map(mk),
    reach,
    priceSamples: totalN,
    expertiseApplied,
    suggestions: out.slice(0, TOP),
  };
}
