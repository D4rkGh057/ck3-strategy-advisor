import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { charName, idList, num, playerIdOf } from "./common.js";
import { inRealm } from "./expansion.js";
import { resolveTitleName } from "./titleUtils.js";

type Rec = Record<string, unknown>;

export interface TradeMarketRef {
  id: number;
  /** Name of the market's location title (a barony). */
  place: string;
}

export interface TradeRoute {
  id: number;
  ownerId: number | null;
  owner: string;
  /** `profit` (earns gold for the owner) or `distribution` (moves goods to where they are needed). */
  mode: string;
  primaryGood: string | null;
  gold: number | null;
  markets: TradeMarketRef[];
  /** Character running the caravan, when one is assigned. */
  trader: { id: number; name: string } | null;
  idleMonths: number | null;
  transactions: number;
}

export interface CategoryExpertise {
  category: string;
  xp: number;
  level: number;
  /** XP still missing for the next level. */
  toNext: number;
  /** XP is stored but none of your routes fulfils this category, so it is probably decaying. */
  decaying: boolean;
}

export interface TradeInfo {
  /** Trade expertise per category with XP; null when the category names are unavailable. */
  expertise: CategoryExpertise[] | null;
  /** The player holds no land, so there is no realm to scan (merchant / landless). */
  landless: boolean;
  competitiveness: number | null;
  own: TradeRoute[];
  /** Routes of other owners that pass through a market containing a county of your realm. */
  realm: TradeRoute[];
  realmMarkets: number;
  worldRoutes: number;
}

function goodName(loc: Localizer, key: string): string {
  const v = loc.resolve(key);
  return v !== key ? v : key.replace(/^trade_good_/, "").replace(/_/g, " ");
}

/** Every transaction and demand block of a route, whether jomini returned one object or an array. */
function ownRaw(routes: Record<string, Rec>, id: number): Rec[] {
  const r = routes[String(id)] ?? {};
  const out: Rec[] = [];
  for (const k of ["transactions", "demand"]) {
    const v = r[k];
    if (Array.isArray(v)) out.push(...(v as Rec[]));
    else if (v && typeof v === "object") out.push(v as Rec);
  }
  return out;
}

/** Categories that at least one of the given routes fulfils (a `fulfilled_category` in its blocks). */
export function fulfilledCategories(
  routes: Record<string, Rec>,
  routeIds: Iterable<number>,
): Set<string> {
  const out = new Set<string>();
  for (const id of routeIds)
    for (const t of ownRaw(routes, id)) {
      const c = t["fulfilled_category"];
      if (typeof c === "string") out.add(c);
    }
  return out;
}

function buildRoute(q: Query, loc: Localizer, id: number, r: Rec): TradeRoute {
  const ownerId = num(r["owner"]);
  const trader = num((r["trader"] as Rec | undefined)?.["character"]);
  const good = typeof r["primary_good"] === "string" ? r["primary_good"] : null;
  const txs = r["transactions"];
  return {
    id,
    ownerId,
    owner: ownerId !== null ? charName(q, ownerId) : "?",
    mode: typeof r["mode"] === "string" ? r["mode"] : "?",
    primaryGood: good !== null ? goodName(loc, good) : null,
    gold: num(r["gold"]),
    markets: idList(r["trade_markets"]).map((m) => {
      const location = num(q.at(`/trade_markets/database/${m}/location`));
      return { id: m, place: location !== null ? resolveTitleName(q, loc, location) : "?" };
    }),
    trader: trader !== null ? { id: trader, name: charName(q, trader) } : null,
    idleMonths: num(r["idle_months"]),
    transactions: Array.isArray(txs) ? txs.length : txs ? 1 : 0,
  };
}

/**
 * Trade routes you own, plus other owners' routes crossing the markets your realm sits in
 * (Silk and Silver saves). The save stores no per-route income history, only the current
 * `gold` balance and the transactions of the route.
 */
/** A landless merchant's only title is an `x_c_merchant_*` company title, not a realm. */
export function isLandless(q: Query, playerId: number): boolean {
  const domain = idList(q.at(`/living/${playerId}/landed_data/domain`));
  const key =
    domain[0] !== undefined ? q.at(`/landed_titles/landed_titles/${domain[0]}/key`) : null;
  return domain.length === 0 || (typeof key === "string" && key.startsWith("x_"));
}

/** Ids of the trade markets that contain a county of the player's realm (empty when landless). */
export function realmMarketIds(q: Query, playerId: number): number[] {
  if (isLandless(q, playerId)) return [];
  const markets = (q.at("/trade_markets/database") as Record<string, Rec> | undefined) ?? {};
  const out: number[] = [];
  for (const [id, m] of Object.entries(markets))
    if (idList(m["titles"]).some((t) => inRealm(q, playerId, t))) out.push(Number(id));
  return out;
}

export function extractTrade(
  q: Query,
  loc: Localizer,
  categories: string[] | null = null,
  xpPerLevel = 150,
): TradeInfo | null {
  const routes = q.at("/trade_routes/database") as Record<string, Rec> | undefined;
  if (!routes || typeof routes !== "object") return null;
  const playerId = playerIdOf(q);
  const landless = isLandless(q, playerId);

  const own: TradeRoute[] = [];
  for (const [idStr, r] of Object.entries(routes))
    if (r && r["owner"] === playerId) own.push(buildRoute(q, loc, Number(idStr), r));

  const realmIds = new Set<number>();
  const realmMarkets = realmMarketIds(q, playerId);
  for (const m of realmMarkets)
    for (const r of idList(q.at(`/trade_markets/database/${m}/trade_routes`))) realmIds.add(r);
  const ownIds = new Set(own.map((r) => r.id));
  const realm: TradeRoute[] = [];
  for (const id of realmIds) {
    const r = routes[String(id)];
    if (r && !ownIds.has(id)) realm.push(buildRoute(q, loc, id, r));
  }
  const byGold = (a: TradeRoute, b: TradeRoute) => (b.gold ?? -Infinity) - (a.gold ?? -Infinity);
  own.sort(byGold);
  realm.sort(byGold);

  // company_progression/category_xp: one XP value per category, in the game's category order.
  const domain = idList(q.at(`/living/${playerId}/landed_data/domain`));
  const rawXp =
    domain[0] !== undefined
      ? q.at(`/landed_titles/landed_titles/${domain[0]}/company_progression/category_xp`)
      : undefined;
  let expertise: CategoryExpertise[] | null = null;
  if (categories && Array.isArray(rawXp) && rawXp.length === categories.length) {
    const active = fulfilledCategories(
      routes,
      own.map((r) => r.id),
    );
    expertise = [];
    rawXp.forEach((v, i) => {
      const xp = num(v);
      if (xp === null || xp <= 0) return;
      const level = Math.floor(xp / xpPerLevel);
      expertise!.push({
        category: categories[i]!,
        xp,
        level,
        toNext: (level + 1) * xpPerLevel - xp,
        decaying: !active.has(categories[i]!),
      });
    });
    expertise.sort((a, b) => b.xp - a.xp);
  }

  return {
    expertise,
    landless,
    competitiveness: num(q.at(`/living/${playerId}/landed_data/trade_competitiveness`)),
    own,
    realm,
    realmMarkets: realmMarkets.length,
    worldRoutes: Object.keys(routes).length,
  };
}
