import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { truncate } from "../format.js";
import { READ_ONLY, errorResult, loadSnapshot, stamped } from "./kit.js";

export function registerMilitaryTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "military",
    {
      title: "Military",
      description:
        "Player's military strength (levy + total mobilised strength), the ruler's own men-at-arms regiments " +
        "(type, size, where stationed), and ongoing wars (side, casus belli, target, war score). " +
        "Men-at-arms hired by vassals are not included.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const snap = await loadSnapshot(cache);
      if (!snap.ok) return errorResult(snap.error);
      const m = snap.value.military;

      // A merchant company has no levy or strength in the save; other missing values stay "?".
      const merchant = snap.value.overview.government === "merchant_government";
      const missing = merchant ? "n/a" : "?";
      const levyStr = m.levy !== null ? Math.round(m.levy).toString() : missing;
      const strengthStr = m.strength !== null ? Math.round(m.strength).toString() : missing;
      const currentStr =
        m.currentStrength !== null ? Math.round(m.currentStrength).toString() : missing;

      let body = `# Military\n- Levy: ${levyStr} | Total strength: ${strengthStr} (current ${currentStr})\n`;
      if (merchant && m.levy === null && m.strength === null)
        body += "- Merchant company: no levy or standing strength in the save.\n";

      body += `## Men-at-arms (${m.menAtArms.length})\n`;
      if (m.menAtArms.length === 0) body += "None.\n";
      for (const r of m.menAtArms) {
        const where =
          r.stationedProvince !== null
            ? `stationed at ${cache.provinceName(r.stationedProvince)}`
            : "not stationed";
        body += `- ${r.type}: ${r.size} men, ${where}\n`;
      }

      const { shown, note } = truncate(m.wars, 5);
      if (shown.length === 0) {
        body += "## Wars (0)\nAt peace.";
      } else {
        body += `## Wars (${m.wars.length})\n`;
        for (const w of shown) {
          const yourScore = w.playerSide === "attacker" ? w.attackerScore : w.defenderScore;
          const theirScore = w.playerSide === "attacker" ? w.defenderScore : w.attackerScore;
          const target = w.targetTitle ?? "(unknown)";
          body +=
            `- ${w.playerSide.toUpperCase()} vs ${target} — ${w.cbType}, ` +
            `score you ${yourScore} / them ${theirScore}, since ${w.startDate}\n`;
        }
        body += note;
      }

      return stamped(snap.value, body);
    },
  );
}
