import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { stamp } from "../format.js";
import { loadCategoryModel, loadTradeGoods, loadXpLevelThreshold } from "../tradeGoods.js";
import { extractTradeSuggestions, type Suggestion } from "../extract/tradeSuggestions.js";

function goodName(cache: SnapshotCache, key: string): string {
  const v = cache.loc.resolve(key);
  return v !== key ? v : key.replace(/^trade_good_/, "").replace(/_/g, " ");
}

function categoryName(cache: SnapshotCache, key: string): string {
  const v = cache.loc.resolve(key);
  return v !== key ? v : key.replace(/^trade_category_/, "").replace(/_/g, " ");
}

function line(cache: SnapshotCache, s: Suggestion): string {
  const flows = s.flows
    .map(
      (f) =>
        `${f.direction === "out" ? "sell" : "buy"} ${Math.round(f.amount)} ${goodName(cache, f.good)}`,
    )
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
        "Market pairs worth a new trade route (Silk and Silver saves), ranked by unsold surplus on one side meeting " +
        "unmet need on the other, valued at the average price seen in existing route transactions. Your anchor " +
        "markets are those of your realm, of your own routes and of your capital's duchy; pairs you already link " +
        "are skipped. Goods are named from the game files (CK3_GAME_DIR), because the save keys them by position; " +
        "without them the tool refuses rather than guess. Limits: the save does not say which markets CAN be " +
        "connected, nor route limits, costs or income, so candidates are cut to the 90th-percentile hop an existing route " +
        "already makes (when province distances are available) and the score is a ranking estimate, not a profit. " +
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
      const snap = await cache.get();
      if ("error" in snap) return { isError: true, content: [{ type: "text", text: snap.error }] };
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

      let body = `# Trade route suggestions (${info.suggestions.length})\n\n`;
      body += `Anchors: ${info.anchors.map((m) => `${m.place} (${m.id})`).join(", ")}\n`;
      body += info.expertiseApplied
        ? "Scores include your trade expertise (per-level price modifiers).\n"
        : "Scores do not include trade expertise (category data or XP not available).\n";
      body +=
        info.reach !== null
          ? `Candidates limited to distance ≤ ${Math.round(info.reach)} (90th-percentile hop of existing routes).\n\n`
          : "No distance data: candidates are not limited by reach, so far pairs may not be connectable.\n\n";
      if (info.suggestions.length === 0)
        body += "No pair with unsold surplus meeting unmet need.\n";
      else body += info.suggestions.map((s) => line(cache, s)).join("");
      body +=
        "\n_Scores rank pairs; they are not income. Connectability and route limits are not in the save._\n";
      return say(body);
    },
  );
}
