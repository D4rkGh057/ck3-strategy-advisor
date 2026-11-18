import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { stamp, truncate } from "../format.js";
import { extractPrisoners, type Prisoner } from "../extract/prisoners.js";
import { SKILL_NOTE, formatEffective } from "../extract/skills.js";

function prisonerBlock(p: Prisoner): string {
  const where =
    p.type === "dungeon" ? "dungeon" : p.type === "house_arrest" ? "house arrest" : p.type;
  const held = p.years !== null ? `${p.years}y (since ${p.since})` : `since ${p.since}`;
  const head =
    `- ${p.name} (${p.id}, ${p.female ? "F" : "M"}${p.age !== null ? `, age ${p.age}` : ""}` +
    `${p.kinship ? `, your ${p.kinship}` : ""}) — ${where}, held ${held}` +
    `${p.isHeir ? " — ★ in your line of succession" : ""}\n`;
  const lines = [head];
  lines.push(
    `  ${formatEffective(p.skills)}${p.traits.length ? ` — ${p.traits.join(", ")}` : ""}` +
      `${p.health !== null ? ` — health ${p.health.toFixed(1)}` : ""}\n`,
  );
  if (p.court) lines.push(`  Court: ${p.court.name} (${p.court.id})\n`);
  for (const l of p.leads) lines.push(`  → ${l}\n`);
  return lines.join("");
}

export function registerPrisonersTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "prisoners",
    {
      title: "Prisoners",
      description:
        "The characters you hold prisoner (dungeon or house arrest) with how long they have been held, kinship to " +
        "you, skills and traits, whose court they belong to, whether they rule land (title tier, army, gold), " +
        "whether they hold a claim on your titles, and a short lead per prisoner on what to do (ransom, release, " +
        "keep, marry). Also lists your close kin held by OTHER rulers (rescue candidates) and flags if you yourself " +
        "are imprisoned. The leads come only from facts visible in the save. Limits: the ransom price, the reason " +
        "for the imprisonment, tyranny/dread effects and which interactions are currently allowed are not in the " +
        "save, and only prisoners held by you are listed in full. " +
        SKILL_NOTE,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const res = await cache.memoQuery("prisoners", (q, shared) => ({
        info: extractPrisoners(q, cache.loc, cache.lookup, shared),
      }));
      if ("error" in res) return { isError: true, content: [{ type: "text", text: res.error }] };
      const snap = await cache.get();
      if ("error" in snap) return { isError: true, content: [{ type: "text", text: snap.error }] };
      const { info } = res;
      if (!info) return { content: [{ type: "text", text: stamp(snap, "Player not found.") }] };

      let body = `# Prisoners you hold: ${info.held.length}\n\n`;
      if (info.playerImprisoned)
        body +=
          `⚠ You are imprisoned by ${info.playerImprisoned.imprisonerName} ` +
          `(${info.playerImprisoned.type}, since ${info.playerImprisoned.since}).\n\n`;
      if (info.held.length === 0) body += "You hold no prisoners.\n";
      else {
        const t = truncate(info.held, 25);
        body += t.shown.map(prisonerBlock).join("") + t.note;
      }
      if (info.kinHeldByOthers.length > 0) {
        body += `\n# Your close kin held by others: ${info.kinHeldByOthers.length}\n\n`;
        const t = truncate(info.kinHeldByOthers, 15);
        body += t.shown.map(prisonerBlock).join("") + t.note;
      }
      body += `\n_${info.worldTotal} characters are imprisoned in the whole save._\n`;
      return { content: [{ type: "text", text: stamp(snap, body) }] };
    },
  );
}
