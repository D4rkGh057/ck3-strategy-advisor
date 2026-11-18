import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { stamp, truncate } from "../format.js";
import { extractTrade, type CategoryExpertise, type TradeRoute } from "../extract/trade.js";
import { loadTradeCategories, loadXpLevelThreshold } from "../tradeGoods.js";
import { errorResult, loadQuery, loadSnapshot } from "./kit.js";

function categoryName(cache: SnapshotCache, key: string): string {
  const v = cache.loc.resolve(key);
  return v !== key ? v : key.replace(/^trade_category_/, "").replace(/_/g, " ");
}

function expertiseLine(cache: SnapshotCache, e: CategoryExpertise): string {
  const decay = e.decaying ? " — no route of yours fulfils it, probably losing XP" : "";
  return `- ${categoryName(cache, e.category)}: level ${e.level} (${e.xp.toFixed(0)} XP, ${e.toNext.toFixed(0)} to next)${decay}
`;
}

function line(r: TradeRoute, showOwner: boolean): string {
  const markets = r.markets.map((m) => m.place).join(" → ") || "no markets";
  const gold = r.gold !== null ? `, ${r.gold.toFixed(2)} gold in the route` : "";
  const trader = r.trader
    ? `, caravan master ${r.trader.name} (${r.trader.id})`
    : ", no caravan master";
  const idle = r.idleMonths ? `, idle ${r.idleMonths} mo` : "";
  const owner = showOwner && r.ownerId !== null ? ` — owner ${r.owner} (${r.ownerId})` : "";
  return (
    `- Route ${r.id}: ${r.primaryGood ?? "mixed goods"}, ${r.mode} — ${markets}` +
    `${gold}${trader}${idle}, ${r.transactions} transactions${owner}\n`
  );
}

export function registerTradeTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "trade",
    {
      title: "Trade routes",
      description:
        "Trade routes (Silk and Silver saves): the routes you own, and other owners' routes that pass through a " +
        "market where your realm holds a county. Each route shows its main good, mode (profit or distribution), " +
        "the markets it links, the gold currently held in it, the caravan master, months idle and the number of " +
        "transactions, plus your trade competitiveness and your trade expertise per category (level = XP / the game's XP threshold, with a flag when no route of yours fulfils a category that still has XP, an inference). Limits: a landless merchant has no realm, so only owned " +
        "routes are listed; the save has no per-route income history, no route profit rate and no trade-post " +
        "ownership, so profit is only the route's current gold balance. Saves from before Silk and Silver have " +
        "no trade data.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const res = await loadQuery(cache, "trade", (q) =>
        extractTrade(
          q,
          cache.loc,
          loadTradeCategories(cache.game.root),
          loadXpLevelThreshold(cache.game.root),
        ),
      );
      if (!res.ok) return errorResult(res.error);
      const snapLoad = await loadSnapshot(cache);
      if (!snapLoad.ok) return errorResult(snapLoad.error);
      const snap = snapLoad.value;
      const info = res.value;
      if (!info)
        return {
          content: [
            {
              type: "text",
              text: stamp(
                snap,
                "This save has no trade routes (pre-Silk and Silver or the DLC is off).",
              ),
            },
          ],
        };

      let body = `# Trade routes you own: ${info.own.length}\n\n`;
      if (info.competitiveness !== null)
        body += `Trade competitiveness: ${info.competitiveness}\n\n`;
      if (info.own.length === 0) body += "You own no trade routes.\n";
      else {
        const t = truncate(info.own, 25);
        body += t.shown.map((r) => line(r, false)).join("") + t.note;
      }
      body += "\n# Trade expertise by category\n\n";
      if (info.expertise === null)
        body +=
          "Not shown: the game files were not found (set CK3_GAME_DIR), so category names cannot be trusted.\n";
      else if (info.expertise.length === 0) body += "No category has XP yet.\n";
      else body += info.expertise.map((e) => expertiseLine(cache, e)).join("");
      body += `\n# Routes through your realm's markets: ${info.realm.length}\n\n`;
      if (info.landless) body += "You hold no land, so there is no realm to scan.\n";
      else if (info.realm.length === 0)
        body += `No other routes cross your ${info.realmMarkets} realm market(s).\n`;
      else {
        const t = truncate(info.realm, 25);
        body += t.shown.map((r) => line(r, true)).join("") + t.note;
      }
      body += `\n_${info.worldRoutes} trade routes exist in the whole save._\n`;
      return { content: [{ type: "text", text: stamp(snap, body) }] };
    },
  );
}
