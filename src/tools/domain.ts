import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { extractDomain, type Holding } from "../extract/domain.js";
import { READ_ONLY, run } from "./kit.js";

function holdingLine(h: Holding, cache: SnapshotCache): string {
  const parts = [
    h.type ?? "unknown holding",
    h.levy !== null ? `levy ${Math.round(h.levy)}` : null,
    h.garrison !== null ? `garrison ${Math.round(h.garrison)}` : null,
    h.income !== null ? `income ${h.income.toFixed(2)}` : null,
    h.fortLevel !== null ? `fort ${h.fortLevel}` : null,
  ].filter(Boolean);
  const where = h.province !== null ? ` [${cache.provinceName(h.province)}]` : "";
  const buildings =
    h.buildings.length > 0
      ? `\n    - Buildings: ${h.buildings.join(", ")}`
      : "\n    - Buildings: none";
  const building =
    h.constructions.length > 0
      ? "\n" +
        h.constructions
          .map((c) => {
            const cost = [
              c.gold !== null ? `${Math.round(c.gold)} gold` : null,
              c.prestige !== null ? `${Math.round(c.prestige)} prestige` : null,
            ].filter(Boolean);
            const since = c.startedOn ? `, started ${c.startedOn}` : "";
            const days = c.days !== null ? `, ${c.days} days left` : "";
            return `    - Under construction: ${c.building} (${cost.join(" + ") || "cost n/a"}${since}${days})`;
          })
          .join("\n")
      : "";
  return (
    `  - ${h.title}${where}${h.isCapital ? " ★capital" : ""}${h.leased ? " (leased temple, not counted in the domain limit)" : ""}: ${parts.join(", ")}` +
    `${buildings}${building}; ${h.emptySlots} empty slot(s)`
  );
}

export function registerDomainTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "domain",
    {
      title: "Domain",
      description:
        "Land you hold personally: each county's development, control and culture, and each holding's type, " +
        "buildings, buildings under construction (cost, start date), empty building slots, levy, garrison, income and fort level, plus holdings vs your domain " +
        "limit. Use it to plan construction or decide what to grant away.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run(
        cache,
        "domain",
        (q) => extractDomain(q, cache.loc, cache.game),
        (d) => {
          let body = `# Domain — ${d.holdingCount}/${d.domainLimit ?? "?"} holdings\n`;
          for (const c of d.counties) {
            body +=
              `- ${c.title}: development ${c.development ?? "?"}, control ${c.control ?? "?"}` +
              `${c.culture ? `, culture ${c.culture}` : ""}\n`;
            for (const h of c.holdings) body += holdingLine(h, cache) + "\n";
          }
          if (d.looseHoldings.length) {
            body += "- Holdings in counties you don't hold:\n";
            for (const h of d.looseHoldings) body += holdingLine(h, cache) + "\n";
          }
          if (d.counties.length === 0 && d.looseHoldings.length === 0) body += "No land held.\n";
          return body;
        },
      ),
  );
}
