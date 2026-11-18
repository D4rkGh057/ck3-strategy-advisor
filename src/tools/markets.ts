import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { block, stamp, truncate } from "../format.js";
import { loadTradeGoods } from "../tradeGoods.js";
import { extractMarkets, type GoodAmount, type MarketSummary } from "../extract/markets.js";
import { errorResult, loadQuery, loadSnapshot, READ_ONLY, textResult } from "./kit.js";

const TOP_GOODS = 6;

function goodName(cache: SnapshotCache, key: string): string {
  const v = cache.loc.resolve(key);
  return v !== key ? v : key.replace(/^trade_good_/, "").replace(/_/g, " ");
}

function goodsText(cache: SnapshotCache, list: GoodAmount[]): string {
  if (list.length === 0) return "none";
  const shown = list
    .slice(0, TOP_GOODS)
    .map((g) => `${goodName(cache, g.good)} ${Math.trunc(g.amount)}`);
  const more = list.length > TOP_GOODS ? `, +${list.length - TOP_GOODS} more` : "";
  return shown.join(", ") + more;
}

export function line(cache: SnapshotCache, m: MarketSummary): string {
  const own = m.ownRoutes > 0 ? ` (${m.ownRoutes} yours)` : "";
  return (
    `- ${m.place} (${m.id}) [${m.links.join(", ")}] — ${m.routes} route(s)${own}; ` +
    `unsold surplus: ${goodsText(cache, m.surplus)}; unmet need: ${goodsText(cache, m.deficit)}`
  );
}

export function registerMarketsTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "markets",
    {
      title: "Your trade markets",
      description:
        "The trade markets that are yours (Silk and Silver saves): those holding a county of your realm, those your own " +
        "routes cross, and the one of your capital's duchy. For each: how many routes cross it (and how many are " +
        "yours), the goods with unsold surplus and the goods with unmet need, in units, largest first. Use it to see " +
        "where there is room for a new route or where a market is saturated; `trade_suggestions` ranks concrete " +
        "pairs. Surplus is surplus minus import_only_need (the trade-hub need) and need is need minus " +
        "distribution_import, as the game's market panel shows them (verified on one save); exports and plain imports " +
        "are not subtracted. Goods are named from the game files (CK3_GAME_DIR), because the save keys them " +
        "by position; without them the tool refuses rather than guess. Not in the save: prices per market, " +
        "which markets can be connected, or per-market income.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const goods = loadTradeGoods(cache.game.root);
      const res = await loadQuery(cache, "markets", (q) => extractMarkets(q, cache.loc, goods));
      if (!res.ok) return errorResult(res.error);
      const snapLoad = await loadSnapshot(cache);
      if (!snapLoad.ok) return errorResult(snapLoad.error);
      const snap = snapLoad.value;
      const info = res.value;
      const say = (t: string) => textResult(stamp(snap, t));
      if (!info) return say("This save has no trade data (pre-Silk and Silver or the DLC is off).");
      if (!info.goodsAvailable)
        return say(
          "Cannot name trade goods: the game files were not found (set CK3_GAME_DIR). The save keys goods by their " +
            "position in the game's trade good list, so the tool will not guess.",
        );
      if (info.markets.length === 0)
        return say(
          "No markets of yours: you hold no county in a market, own no route, and your capital has no market.",
        );
      const t = truncate(info.markets, 25);
      return say(
        `# Your markets (${info.markets.length})\n\n` +
          block(t.shown.map((m) => line(cache, m))) +
          t.note,
      );
    },
  );
}
