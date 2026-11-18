import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { stamp } from "../format.js";
import { loadCategoryModel, loadTradeGoods, loadXpLevelThreshold } from "../tradeGoods.js";
import { extractTradeSuggestions, type Suggestion } from "../extract/tradeSuggestions.js";
import { errorResult, loadSnapshot } from "./kit.js";

function goodName(cache: SnapshotCache, key: string): string {
  const v = cache.loc.resolve(key);
  return v !== key ? v : key.replace(/^trade_good_/, "").replace(/_/g, " ");
}

function categoryName(cache: SnapshotCache, key: string): string {
  const v = cache.loc.resolve(key);
  return v !== key ? v : key.replace(/^trade_category_/, "").replace(/_/g, " ");
}

/**
 * One markdown bullet for a pair, or null when no flow is worth showing. Flows under half a unit
 * would render as "0 <good> (+0.00)", so they are left out of the text (the score still counts them).
 */
export function line(cache: SnapshotCache, s: Suggestion): string | null {
  const visible = s.flows.filter((f) => Math.round(f.amount) >= 1);
  if (visible.length === 0) return null;
  // The route buys where the good is in surplus and sells where it is needed (the game's own wording).
  const flows = visible
    .map((f) => {
      const [from, to] = f.direction === "out" ? [s.anchor, s.other] : [s.other, s.anchor];
      return `${Math.round(f.amount)} ${goodName(cache, f.good)} (buy ${from.place}, sell ${to.place}, +${f.profit.toFixed(2)})`;
    })
    .join(", ");
  const dist = s.distance !== null ? `, distance ${Math.round(s.distance)}` : "";
  const xp = s.xpCategories.length
    ? `; expertise: ${s.xpCategories
        .map(
          (x) =>
            `${categoryName(cache, x.category)} lvl ${x.level} via ${x.goods.map((g) => goodName(cache, g)).join("/")}${x.decaying ? " (no route of yours covers it now)" : ""}`,
        )
        .join(", ")}`
    : "";
  const shared = s.existingRoutes > 0 ? `, ${s.existingRoutes} route(s) already cross both` : "";
  return `- ${s.anchor.place} (${s.anchor.id}) ↔ ${s.other.place} (${s.other.id}) — score ${s.score.toFixed(1)}: ${flows}${dist}${shared}${xp}\n`;
}

export function registerTradeSuggestionsTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "trade_suggestions",
    {
      title: "Trade route suggestions",
      description:
        "Market pairs worth a new trade route (Silk and Silver saves), ranked by estimated profit: a route earns what " +
        "it sells minus what it buys (the route's `gold` in the save is exactly that), so each good with unsold surplus " +
        "on one side meeting unmet need on the other adds units x (sell price - buy price), using the average buy and " +
        "sell prices seen in existing route transactions. The score is in the same unit as a route's `gold`, so " +
        "compare it with the balance of the route you run now. Your anchor " +
        "markets are those of your realm, of your own routes and of your capital's duchy; pairs you already link " +
        "are skipped. Goods are named from the game files (CK3_GAME_DIR), because the save keys them by position; " +
        "without them the tool refuses rather than guess. Limits: the save does not say which markets CAN be " +
        "connected, nor your route length limit (province hops, +10 base plus modifiers), costs or income, so candidates " +
        "are cut to the longest route you already run (the game's base of 10 if you run none), converted to a " +
        "distance with the hops-per-distance ratio of existing routes (when province distances are available): an " +
        "estimate that can under- or over-state the real limit. The score is an estimate: it assumes the route " +
        "carries every good listed (routes with several goods exist, but the save does not say how many a route can " +
        "carry), ignores caravan capacity and stop limits, and a pair is only two stops. " +
        "Surplus is read as surplus minus export and need as need minus import, an inference from the save fields. " +
        "With the game files available, goods of categories where you hold trade expertise are valued with the " +
        "category's per-level price modifier (usually +0.1% sell price per level, so a small effect), and each pair " +
        "lists the categories where it would keep or grow your XP, flagging those no route of yours covers now. " +
        "Milestone bonuses and the value of XP itself are not modelled.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const goods = loadTradeGoods(cache.game.root);
      const res = await cache.memoQuery("trade_suggestions", (q) => ({
        info: extractTradeSuggestions(
          q,
          cache.loc,
          cache.game,
          goods,
          loadCategoryModel(cache.game.root),
          loadXpLevelThreshold(cache.game.root),
        ),
      }));
      if ("error" in res) return { isError: true, content: [{ type: "text", text: res.error }] };
      const snapLoad = await loadSnapshot(cache);
      if (!snapLoad.ok) return errorResult(snapLoad.error);
      const snap = snapLoad.value;
      const { info } = res;
      const say = (t: string) => ({ content: [{ type: "text" as const, text: stamp(snap, t) }] });
      if (!info) return say("This save has no trade data (pre-Silk and Silver or the DLC is off).");
      if (!info.goodsAvailable)
        return say(
          "Cannot name trade goods: the game files were not found (set CK3_GAME_DIR). The save keys goods by their " +
            "position in the game's trade good list, so the tool will not guess.",
        );
      if (info.anchors.length === 0)
        return say(
          "No anchor markets: you hold no county in a market, own no route, and your capital has no market.",
        );

      const lines = info.suggestions.map((s) => line(cache, s)).filter((l) => l !== null);
      let body = `# Trade route suggestions (${lines.length})\n\n`;
      body += `Anchors: ${info.anchors.map((m) => `${m.place} (${m.id})`).join(", ")}\n`;
      body += info.expertiseApplied
        ? "Scores include your trade expertise (per-level price modifiers).\n"
        : "Scores do not include trade expertise (category data or XP not available).\n";
      const len = info.routeLength;
      const lenWhy =
        len.basis === "own"
          ? `the longest route you run is ${len.maxHops} hops; your real limit may be higher`
          : `you run no profit route, so the game's base of ${len.maxHops} hops is assumed`;
      body +=
        info.reach !== null
          ? `Route length: ${len.maxHops} province hops (${lenWhy}). Candidates limited to distance ≤ ${Math.round(info.reach)} (estimated from ${len.hopsPerDistance!.toFixed(3)} hops per distance unit in existing routes).\n\n`
          : `Route length: ${len.maxHops} province hops (${lenWhy}). No distance data: candidates are not limited, so far pairs may exceed it.\n\n`;
      if (lines.length === 0) body += "No pair with unsold surplus meeting unmet need.\n";
      else body += lines.join("");
      body +=
        "\n_Scores estimate a route's gold balance (sell - buy). Connectability, impassable terrain and route limits are not in the save._\n";
      return say(body);
    },
  );
}
