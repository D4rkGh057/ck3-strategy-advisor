import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { stamp } from "../format.js";
import { extractFactions } from "../extract/vassals.js";
import {
  ROLE_SKILL,
  riskNotes,
  suggestCouncil,
  extractCouncil,
  type Courtier,
  type CouncilRole,
} from "../extract/council.js";
import { errorResult, loadQuery, loadSnapshot } from "./kit.js";

const NO_COUNCIL_GOVERNMENT = "merchant_government";

function line(c: Courtier): string {
  const s = c.skills;
  const age = c.age !== null ? `, age ${c.age}` : "";
  const tags = [
    c.vassal ? "vassal" : "",
    c.spouse ? "spouse" : "",
    c.knight ? "knight" : "",
    c.sameHouse ? "your house" : "",
    c.seat ? `seat: ${c.seat}` : "",
  ].filter(Boolean);
  const risks = riskNotes(c);
  return (
    `- ${c.name} (${c.id}${age}): DIP ${s.diplomacy} / MAR ${s.martial} / STE ${s.stewardship} / ` +
    `INT ${s.intrigue} / LEA ${s.learning} / PRO ${s.prowess}` +
    (tags.length ? ` [${tags.join(", ")}]` : "") +
    (c.traits.length ? `\n  traits: ${c.traits.join(", ")}` : "") +
    (risks.length ? `\n  ⚠ ${risks.join("; ")}` : "")
  );
}

function brief(c: Courtier, role: CouncilRole): string {
  const risks = riskNotes(c);
  return (
    `${c.name} (${c.id}, ${ROLE_SKILL[role]} ${c.skills[ROLE_SKILL[role]]}` +
    (c.vassal ? ", vassal" : "") +
    (risks.length ? `; ⚠ ${risks.join(", ")}` : "") +
    ")"
  );
}

export function registerCouncilTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "council",
    {
      title: "Council",
      description:
        "Your council seats (chancellor, steward, marshal, spymaster, court chaplain, incl. seats held by landed vassals) and everyone eligible: courtiers and direct vassals with in-game skills, traits, age, health, opinion of you, claims on your titles and faction membership, plus a suggested reshuffle that maximises each seat's primary skill minus risk penalties. Still check faith (chaplain), secrets and relationships before swapping: those are not in the save data used here. A merchant only has the spouse seat: the tool says so instead of suggesting the five classic seats.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const snapLoad = await loadSnapshot(cache);
      if (!snapLoad.ok) return errorResult(snapLoad.error);
      const snap = snapLoad.value;
      const year = Number.parseInt(snap.date, 10);
      // Same key and shape as `court_candidates`, so the two share one extraction per save.
      const result = await loadQuery(cache, "council", (q) =>
        extractCouncil(
          q,
          cache.loc,
          cache.lookup,
          Number.isFinite(year) ? year : null,
          extractFactions(q, cache.loc).memberIds,
        ),
      );
      if (!result.ok) return errorResult(result.error);
      const council = result.value;
      // The game's `valid_position` for all five seats excludes government_is_merchant, so a
      // merchant has no council; suggesting seats would be misleading.
      const noCouncil = snap.overview.government === NO_COUNCIL_GOVERNMENT;
      const plan = noCouncil ? [] : suggestCouncil(council);

      let body = "# Council\n";
      if (noCouncil)
        body +=
          "A merchant has no chancellor, steward, marshal, spymaster or court chaplain seat (the game " +
          "excludes them); only the spouse seat exists. Use `court` for the seat holder and the " +
          "court positions (e.g. bodyguards, champion). The list below is only who is in your court.\n";
      for (const a of plan) {
        const cur = a.current ? brief(a.current, a.role) : "vacant";
        const same = a.current?.id === a.suggested?.id;
        body += `- ${a.role}: ${cur}`;
        if (same) body += " — keep\n";
        else if (a.suggested)
          body += ` → suggest ${brief(a.suggested, a.role)} [${a.gain >= 0 ? "+" : ""}${a.gain.toFixed(1)} risk-adjusted]\n`;
        else body += " → no eligible candidate\n";
        if (a.alternatives.length)
          body += `  alternatives: ${a.alternatives.map((c) => brief(c, a.role)).join("; ")}\n`;
      }

      const rest = [...council.courtiers].sort((x, y) => x.id - y.id);
      body += `\n# Candidates (${rest.length})\n` + rest.map(line).join("\n") + "\n";
      return { content: [{ type: "text", text: stamp(snap, body) }] };
    },
  );
}
