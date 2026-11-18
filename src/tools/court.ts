import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { extractCourt, type CourtMember } from "../extract/court.js";
import { SKILL_NAMES } from "../extract/common.js";
import { SKILL_NOTE, formatEffective } from "../extract/skills.js";
import { READ_ONLY, run } from "./kit.js";

function who(m: CourtMember): string {
  return `${m.name} (${m.id}${m.age !== null ? `, age ${m.age}` : ""})`;
}

export function registerCourtTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "court",
    {
      title: "Court",
      description:
        "Your council (task each councillor is on, with skills and traits), court positions (physician, etc.), " +
        "knights, and the best courtiers for each skill with the post they already hold — use it to pick or " +
        "replace councillors and court positions. Only covers your own court. Skills are base + trait bonuses " +
        "(estimated from the game files, base in brackets); perks/artifacts/temporary modifiers are not included.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run(
        cache,
        "court",
        (q) => extractCourt(q, cache.loc, cache.lookup),
        (c) => {
          let body = `${SKILL_NOTE}\n\n# Council\n`;
          if (c.council.length === 0) body += "Empty.\n";
          for (const s of c.council)
            body +=
              `- ${s.task}: ${who(s.member)} — ${formatEffective(s.member.skills)}` +
              `${s.member.traits.length ? ` — ${s.member.traits.join(", ")}` : ""}\n`;
          body += `\n# Court positions (${c.positions.length})\n`;
          if (c.positions.length === 0) body += "None filled.\n";
          for (const p of c.positions)
            body +=
              `- ${p.position}: ${who(p.member)} — ${formatEffective(p.member.skills)}` +
              `${p.member.traits.length ? ` — ${p.member.traits.join(", ")}` : ""}\n`;
          body += `\n# Knights (${c.knights.length})\n`;
          for (const k of c.knights)
            body += `- ${who(k)} — prowess ${k.skills.effective.prowess}\n`;
          body += `\n# Best courtiers by skill (${c.courtierCount} courtiers)\n`;
          for (const skill of SKILL_NAMES) {
            const list = c.bestBySkill[skill]
              .map(
                (e) =>
                  `${e.member.name} ${e.member.skills.effective[skill]}${e.holds ? ` [${e.holds}]` : ""}`,
              )
              .join("; ");
            body += `- ${skill}: ${list || "none"}\n`;
          }
          return body;
        },
      ),
  );
}
