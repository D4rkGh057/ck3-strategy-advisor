import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { idList, num, playerIdOf } from "./common.js";
import { realmMarketIds } from "./trade.js";
import { capitalDuchy, flowTotals } from "./tradeSuggestions.js";
import { resolveTitleName } from "./titleUtils.js";

type Rec = Record<string, unknown>;

export type MarketLink = "realm" | "own route" | "capital";

export interface GoodAmount {
  good: string;
  amount: number;
}

export interface MarketSummary {
  id: number;
  /** Name of the market's location title (a barony). */
  place: string;
  /** Why this market is yours: it holds a county of your realm, one of your routes crosses it, or it is your capital's. */
  links: MarketLink[];
  routes: number;
  ownRoutes: number;
  /** Unsold surplus per good (surplus - export), largest first. */
  surplus: GoodAmount[];
  /** Unmet need per good (need - import), largest first. */
  deficit: GoodAmount[];
}

export interface MarketsInfo {
  goodsAvailable: boolean;
  markets: MarketSummary[];
}

const MIN_AMOUNT = 0.5;

/**
 * Your markets (realm, own routes, capital duchy) with what each has left unsold and what it
 * still lacks. Surplus and need follow the `trade_suggestions` inference (surplus - export,
 * need - import); the save keys goods by position in the game's good list, so without the list
 * (`goods`) no good can be named and `goodsAvailable` is false.
 */
export function extractMarkets(
  q: Query,
  loc: Localizer,
  goods: string[] | null,
): MarketsInfo | null {
  const markets = q.at("/trade_markets/database") as Record<string, Rec> | undefined;
  const routes = q.at("/trade_routes/database") as Record<string, Rec> | undefined;
  if (!markets || !routes) return null;
  if (!goods) return { goodsAvailable: false, markets: [] };

  const playerId = playerIdOf(q);
  const links = new Map<number, Set<MarketLink>>();
  const link = (id: number, why: MarketLink) => {
    if (!links.has(id)) links.set(id, new Set());
    links.get(id)!.add(why);
  };
  for (const id of realmMarketIds(q, playerId)) link(id, "realm");
  for (const r of Object.values(routes))
    if (r["owner"] === playerId) for (const m of idList(r["trade_markets"])) link(m, "own route");
  const duchy = capitalDuchy(q, playerId);
  if (duchy !== null)
    for (const [id, m] of Object.entries(markets))
      if (m["duchy"] === duchy) link(Number(id), "capital");

  const out: MarketSummary[] = [];
  for (const [id, why] of links) {
    const m = markets[String(id)];
    if (!m) continue;
    const location = num(m["location"]);
    const routeIds = idList(m["trade_routes"]);
    const surplus: GoodAmount[] = [];
    const deficit: GoodAmount[] = [];
    goods.forEach((good, i) => {
      const t = flowTotals((m["good_balances"] as Rec | undefined)?.[String(i)] as Rec | undefined);
      if (t.sell >= MIN_AMOUNT) surplus.push({ good, amount: t.sell });
      if (t.want >= MIN_AMOUNT) deficit.push({ good, amount: t.want });
    });
    const bySize = (a: GoodAmount, b: GoodAmount) => b.amount - a.amount;
    out.push({
      id,
      place: location !== null ? resolveTitleName(q, loc, location) : "?",
      links: [...why],
      routes: routeIds.length,
      ownRoutes: routeIds.filter((r) => routes[String(r)]?.["owner"] === playerId).length,
      surplus: surplus.sort(bySize),
      deficit: deficit.sort(bySize),
    });
  }
  out.sort((a, b) => a.id - b.id);
  return { goodsAvailable: true, markets: out };
}
