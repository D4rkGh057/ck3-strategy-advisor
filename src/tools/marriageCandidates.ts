import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SnapshotCache } from "../cache.js";
import { extractMarriageCandidates, type MarriageCandidate } from "../extract/marriage.js";
import { SKILL_NOTE, formatEffective } from "../extract/skills.js";
import { block } from "../format.js";
import { READ_ONLY, run } from "./kit.js";

function candidateLine(c: MarriageCandidate, n: number): string {
  const where =
    c.source === "ruler"
      ? `rules ${c.ownTitle ?? "a realm"}`
      : c.source === "pool"
        ? "unattached"
        : c.host
          ? `${c.source === "courtier" ? "at the court of" : "child of"} ${c.host.name} (${c.host.id}${c.host.title ? `, ${c.host.title}` : ""})`
          : c.source;
  const lines = [
    `${n}. ${c.name} (${c.id}, ${c.female ? "F" : "M"}, age ${c.age ?? "?"}) — ${where}`,
    `   ${formatEffective(c.skills)}` +
      `${c.traits.length ? ` — ${c.traits.join(", ")}` : ""}` +
      `${c.fertility !== null ? ` — fertility ${c.fertility.toFixed(2)}` : ""}`,
  ];
  const extra: string[] = [];
  if (c.distance !== null) extra.push(`distance ${Math.round(c.distance)}`);
  if (c.allyRuler)
    extra.push(
      c.allyRuler.relation === "self"
        ? `rules (army ${Math.round(c.allyRuler.strength)}): alliance plausible`
        : `${c.allyRuler.relation} ${c.allyRuler.name} rules (army ${Math.round(c.allyRuler.strength)}): alliance plausible`,
    );
  if (c.goodGenes.length) extra.push(`good genes: ${c.goodGenes.join(", ")}`);
  if (c.badGenes.length) extra.push(`⚠ bad genes: ${c.badGenes.join(", ")}`);
  if (c.claims.length) extra.push(`claims: ${c.claims.join(", ")}`);
  if (extra.length) lines.push(`   ${extra.join(" | ")}`);
  if (c.notes.length) lines.push(`   ${c.notes.join("; ")}`);
  return lines.join("\n");
}

export function registerMarriageCandidatesTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "marriage_candidates",
    {
      title: "Marriage candidates",
      description:
        "Who the subject (default: your heir) could marry, rebuilt from the game's own arrange-marriage rules: " +
        "every ruler, courtier and ruler's child of the opposite sex who is unmarried, not betrothed elsewhere and " +
        "not too closely related under both faiths' consanguinity doctrines. Ranked by the standing of the court " +
        "they belong to, then Dip+Stw+Int+Lrn. Limited to the game's diplomatic range (maxDistance) rather than by language. Also shows the strongest ruler among their close family (a marriage alliance is plausible), heritable good/bad genes and claims; rank=priority orders for an heir. " +
        "Does NOT include the acceptance chance shown in the game; check that in the marriage window.",
      inputSchema: {
        id: z
          .number()
          .optional()
          .describe("character id looking for a spouse (omit for your heir)"),
        minAge: z.number().optional().describe("minimum candidate age (default 16)"),
        maxAge: z.number().optional().describe("maximum candidate age (default 45)"),
        sameLanguage: z
          .boolean()
          .optional()
          .describe(
            "only candidates sharing a language with the subject (default false: the game lists by distance, not language)",
          ),
        host: z
          .string()
          .optional()
          .describe("only candidates at / child of a ruler whose name contains this"),
        maxDistance: z
          .number()
          .optional()
          .describe(
            "only people within this map distance of you (default 1130, the game's diplomatic range around Munster; raise it for the whole world)",
          ),
        rank: z
          .enum(["standing", "priority"])
          .optional()
          .describe(
            "standing (default): court tier and rite first. priority: strongest ally first, then youth and fertility, skills, good genes",
          ),
        limit: z.number().optional().describe("how many to list (default 25)"),
      },
      annotations: READ_ONLY,
    },
    async (args: {
      id?: number;
      minAge?: number;
      maxAge?: number;
      sameLanguage?: boolean;
      host?: string;
      maxDistance?: number;
      rank?: "standing" | "priority";
      limit?: number;
    }) =>
      run(
        cache,
        `marriage_candidates:${JSON.stringify(args)}`,
        (q, shared) => extractMarriageCandidates(q, cache.loc, cache.lookup, args, shared),
        (m) => {
          if (!m) return `No character with id ${args.id}.`;
          const s = m.subject;
          let body = `${SKILL_NOTE}\n\n`;
          body += `# Marriage candidates for ${s.name} (${s.id}, ${s.female ? "F" : "M"}, age ${s.age ?? "?"}`;
          body += `${s.rite ? `, ${s.rite}` : ""})\n`;
          body += `${m.total} match(es) out of ${m.scanned} characters checked; showing ${m.candidates.length}.\n`;
          const ex = Object.entries(m.excluded)
            .sort((a, b) => b[1] - a[1])
            .map(([why, n]) => `${why} ${n}`)
            .join(", ");
          if (ex) body += `Filtered out: ${ex}.\n`;
          body += "\n";
          body += block(m.candidates.map((c, i) => candidateLine(c, i + 1)));
          if (m.candidates.length === 0)
            body += "None found. Try a larger maxDistance or a wider age range.\n";
          return body;
        },
      ),
  );
}
