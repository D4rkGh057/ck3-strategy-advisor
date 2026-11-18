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
  /** Units the surplus market can still supply and the other still needs (the smaller of the two). */
  amount: number;
  /** `out` = the route buys at the anchor and sells at the other market; `in` = the reverse. */
  direction: "out" | "in";
  /** `amount` x (sell price - buy price), at the average prices seen in route transactions. */
  profit: number;
}

export interface Suggestion {
  anchor: MarketRef;
  other: MarketRef;
  /**
   * Sum of the flows' profit (sell - buy at the average transaction prices): the same quantity as a
   * route's `gold`, but an estimate that assumes the route carries every good listed.
   */
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
  /** Route length used to cut candidates (province hops) and how it was obtained. */
  routeLength: RouteLengthInfo;
  /** Distance equivalent of `routeLength` on this map; null when distances are unavailable. */
  reach: number | null;
  priceSamples: number;
  /** Expertise levels were applied to the scores (needs the category data and the XP array). */
  expertiseApplied: boolean;
  suggestions: Suggestion[];
}

const TOP = 15;
/** `BASE_MAX_TRADE_ROUTE_LENGTH` in the game's defines: province hops a profit route may span. */
const BASE_ROUTE_LENGTH = 10;

export interface RouteLengthInfo {
  /** Longest route you run in hops (`own`), or the game's base length when you run none (`base`). */
  maxHops: number;
  basis: "own" | "base";
  /** Province hops per unit of straight-line distance seen in existing routes. */
  hopsPerDistance: number | null;
}

interface RouteSample {
  own: boolean;
  hops: number;
  geometric: number | null;
}

/** Duchy title id of the player's primary title's capital county (a landless merchant's company seat). */
export function capitalDuchy(q: Query, playerId: number): number | null {
  const domain = idList(q.at(`/living/${playerId}/landed_data/domain`));
  const capital =
    domain[0] !== undefined ? num(q.at(`/landed_titles/landed_titles/${domain[0]}/capital`)) : null;
  return capital !== null
    ? num(q.at(`/landed_titles/landed_titles/${capital}/de_jure_liege`))
    : null;
}

/**
 * What distribution-mode routes take out of a market, per good key: the `buy` transactions of the
 * distribution routes crossing it. The save has no field for the panel's "distribution exports"
 * (they sit inside the aggregate `export`), but these transactions match them: 15 meat on the
 * 1067 test save, equal to the panel's -15.
 */
export function distributionExports(
  routes: Record<string, Rec>,
  market: Rec | undefined,
  marketId: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of idList(market?.["trade_routes"])) {
    const r = routes[String(id)];
    if (!r || r["mode"] !== "distribution") continue;
    const txs = Array.isArray(r["transactions"]) ? r["transactions"] : [r["transactions"]];
    for (const t of txs as (Rec | undefined)[]) {
      const good = t?.["trade_good"];
      const amount = num(t?.["amount"]);
      if (
        t?.["trade_market"] === marketId &&
        t["type"] === "buy" &&
        typeof good === "string" &&
        amount !== null
      )
        out.set(good, (out.get(good) ?? 0) + amount);
    }
  }
  return out;
}

/**
 * Units a market has available to sell and still wants, as the game's market panel shows them
 * (verified on a 1067 save against the panel): surplus minus the trade-hub need
 * (`import_only_need`) and minus what distribution routes already take out (`distExport`, see
 * `distributionExports`); need minus what distribution routes already deliver
 * (`distribution_import`). The aggregate `export` and plain `import` are not subtracted.
 */
export function flowTotals(r: Rec | undefined, distExport = 0): { sell: number; want: number } {
  const surplus = num(r?.["surplus"]) ?? 0;
  const hubNeed = num(r?.["import_only_need"]) ?? 0;
  const need = num(r?.["need"]) ?? 0;
  const delivered = num(r?.["distribution_import"]) ?? 0;
  return { sell: Math.max(0, surplus - hubNeed - distExport), want: Math.max(0, need - delivered) };
}

/**
 * Ranks market pairs worth a new route: your anchor markets (markets of your realm, of your own
 * routes and of your capital) against every other market, by how much unsold surplus of one side
 * meets unmet need on the other, valued at the profit a route makes on it (sell price minus buy
 * price, averaged separately over the route transactions).
 * The save does not say which pairs can be connected, nor route limits or costs, so candidates are
 * cut to the route length: the longest route you run (in province hops), turned into a distance
 * with the hops-per-distance ratio of existing routes. When the category data is
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
      routeLength: { maxHops: BASE_ROUTE_LENGTH, basis: "base", hopsPerDistance: null },
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
  // A route earns (what it sells) - (what it buys): the save's route `gold` equals that difference,
  // and sell prices run above buy prices, so the two sides are averaged apart.
  const buys = new Map<string, { total: number; n: number }>();
  const sells = new Map<string, { total: number; n: number }>();
  const samples: RouteSample[] = [];
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
      const side = t["type"] === "buy" ? buys : t["type"] === "sell" ? sells : null;
      if (!side) continue;
      const s = side.get(t["trade_good"]) ?? { total: 0, n: 0 };
      s.total += p;
      s.n++;
      side.set(t["trade_good"], s);
    }
    const ms = idList(r["trade_markets"]);
    for (const a of ms)
      for (const b of ms) {
        if (a >= b) continue;
        if (r["owner"] === playerId) linked.add(`${a}-${b}`);
      }
    if (r["owner"] === playerId) ms.forEach((m) => ownMarkets.add(m));
    // Profit routes reveal how many province hops a route takes (`path` lists its provinces) and,
    // against the straight-line distance between its stops, how winding routes are on this map.
    const pathLen = Array.isArray(r["path"]) ? r["path"].length : 0;
    if (r["mode"] === "profit" && pathLen >= 2) {
      let geometric = 0;
      let known = true;
      for (let i = 1; i < ms.length; i++) {
        const d = dist(ms[i - 1]!, ms[i]!);
        if (d === null) known = false;
        else geometric += d;
      }
      samples.push({
        own: r["owner"] === playerId,
        hops: pathLen - 1,
        geometric: known && ms.length >= 2 ? geometric : null,
      });
    }
  }
  // The route length limit is not stored, so the longest route you already run is the only proof of
  // it (the real limit may be higher); without one, the game's base value is all that is known.
  const ownSamples = samples.filter((s) => s.own);
  const maxHops =
    ownSamples.length > 0 ? Math.max(...ownSamples.map((s) => s.hops)) : BASE_ROUTE_LENGTH;
  // Hops per unit of distance, from your own routes when they can be measured, else from all.
  const calibrate = (set: RouteSample[]): number | null => {
    const m = set.filter((s) => s.geometric !== null && s.geometric > 0);
    const geo = m.reduce((t, s) => t + s.geometric!, 0);
    return geo > 0 ? m.reduce((t, s) => t + s.hops, 0) / geo : null;
  };
  const hopsPerDistance = calibrate(ownSamples) ?? calibrate(samples);
  const routeLength: RouteLengthInfo = {
    maxHops,
    basis: ownSamples.length > 0 ? "own" : "base",
    hopsPerDistance,
  };
  // Distance beyond which a pair would need more hops than the route length allows.
  const reach = hopsPerDistance !== null ? maxHops / hopsPerDistance : null;
  const avgOf = (m: Map<string, { total: number; n: number }>, g: string): number | null => {
    const s = m.get(g);
    return s ? s.total / s.n : null;
  };
  const sideTotals = (m: Map<string, { total: number; n: number }>) => {
    let total = 0;
    let n = 0;
    for (const s of m.values()) {
      total += s.total;
      n += s.n;
    }
    return { avg: n > 0 ? total / n : null, n };
  };
  const globalBuy = sideTotals(buys);
  const globalSell = sideTotals(sells);
  const priceSamples = globalBuy.n + globalSell.n;
  // Sell price over buy price, averaged over the goods seen on both sides; it stands in for the
  // missing side of a good that only one kind of transaction has been seen for.
  const ratios: number[] = [];
  for (const g of buys.keys()) {
    const b = avgOf(buys, g);
    const s = avgOf(sells, g);
    if (b !== null && s !== null && b > 0) ratios.push(s / b);
  }
  const sellOverBuy = ratios.length > 0 ? ratios.reduce((t, r) => t + r, 0) / ratios.length : null;
  const buyPrice = (g: string): number | null => {
    const own = avgOf(buys, g);
    if (own !== null) return own;
    const sold = avgOf(sells, g);
    if (sold !== null && sellOverBuy !== null) return sold / sellOverBuy;
    return globalBuy.avg;
  };
  const sellPrice = (g: string): number | null => {
    const own = avgOf(sells, g);
    if (own !== null) return own;
    const bought = avgOf(buys, g);
    if (bought !== null && sellOverBuy !== null) return bought * sellOverBuy;
    return globalSell.avg;
  };

  // Anchors: realm markets, markets of your routes, and the market of your capital's duchy.
  const anchorIds = new Set<number>([...realmMarketIds(q, playerId), ...ownMarkets]);
  const duchy = capitalDuchy(q, playerId);
  if (duchy !== null)
    for (const [id, m] of Object.entries(markets))
      if (m["duchy"] === duchy) anchorIds.add(Number(id));

  // Expertise: XP per category in the game's category order, on the primary (company) title.
  const domain = idList(q.at(`/living/${playerId}/landed_data/domain`));
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
  const priceMult = (good: string, side: "sell" | "buy"): number => {
    let m = 1;
    for (const key of goodCats.get(good) ?? []) {
      const def = cats!.defs.get(key)!;
      const lvl = levels.get(key)!.level;
      m += side === "sell" ? lvl * def.sellPerLevel : lvl * -def.buyPerLevel;
    }
    return m;
  };
  /** Profit per unit moved: the route buys where the good is in surplus and sells where it is needed. */
  const margin = (good: string): number | null => {
    const buy = buyPrice(good);
    const sell = sellPrice(good);
    if (buy === null || sell === null) return null;
    return sell * priceMult(good, "sell") - buy * priceMult(good, "buy");
  };

  const distExports = new Map<number, Map<string, number>>();
  const balance = (id: number, g: number): { sell: number; want: number } => {
    if (!distExports.has(id))
      distExports.set(id, distributionExports(routes, markets[String(id)], id));
    return flowTotals(
      (markets[String(id)]?.["good_balances"] as Rec | undefined)?.[String(g)] as Rec | undefined,
      distExports.get(id)!.get(goods[g]!) ?? 0,
    );
  };

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
        const unit = margin(goods[g]!);
        if (unit === null || unit <= 0) continue;
        if (outAmt > 0)
          flows.push({ good: goods[g]!, amount: outAmt, direction: "out", profit: outAmt * unit });
        if (inAmt > 0)
          flows.push({ good: goods[g]!, amount: inAmt, direction: "in", profit: inAmt * unit });
      }
      if (flows.length === 0) continue;
      flows.sort((x, y) => y.profit - x.profit);
      const score = flows.reduce((s, f) => s + f.profit, 0);
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
    routeLength,
    reach,
    priceSamples,
    expertiseApplied,
    suggestions: out.slice(0, TOP),
  };
}
