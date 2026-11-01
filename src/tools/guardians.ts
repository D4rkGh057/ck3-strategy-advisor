import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SnapshotCache } from "../cache.js";
import { stamp, truncate } from "../format.js";
import {
  extractGuardians,
  type ChildEntry,
  type Person,
  type RoleCandidate,
  type RoleRanking,
} from "../extract/guardians.js";

const ROLE_TITLE: Record<string, string> = {
  tutor: "Court tutor (aptitude: 25 + Learning x2.5 + traits)",
  wet_nurse: "Wet nurse (aptitude: 25 + health + children + traits)",
  caravan_master:
    "Caravan master (aptitude: ~1 + Learning + 1.3 x Stewardship + languages + traits, without speed/safety)",
};

const short = (p: Person) =>
  `${p.name} (${p.id}, ${p.female ? "F" : "M"} ${p.age}${p.landed ? ", landed" : ""})`;

function skills(p: Person): string {
  const s = p.skills;
  return `DIP ${s.diplomacy} MAR ${s.martial} STE ${s.stewardship} INT ${s.intrigue} LEA ${s.learning}`;
}

function candidateLine(c: RoleCandidate): string {
  const p = c.person;
  const notes = [p.holds ? `holds ${p.holds.replace(/_court_position$/, "")}` : "", ...c.caveats]
    .filter(Boolean)
    .join("; ");
  return `- ${short(p)}: aptitude ${Math.round(c.aptitude)} [${skills(p)}]${notes ? ` ⚠ ${notes}` : ""}`;
}

function roleSection(r: RoleRanking, top: number): string {
  const { shown, note } = truncate(r.ranked, top);
  let out = `\n## ${ROLE_TITLE[r.role]}\n`;
  out += `Now: ${r.current ? `${short(r.current.person)}, aptitude ${Math.round(r.current.aptitude)}` : "vacant"}\n`;
  out += shown.length ? shown.map(candidateLine).join("\n") : "- nobody at court qualifies";
  out += note;
  const blocked = truncate(r.excluded, 6);
  if (blocked.shown.length)
    out +=
      "\n\nRuled out (sample): " +
      blocked.shown.map((e) => `${e.person.name} — ${e.reasons.join(", ")}`).join("; ");
  return out + "\n";
}

function childLine(
  c: ChildEntry & { picks: { person: Person; value: number; skill: number }[] },
): string {
  const focus = c.focus ? `focus ${c.focus}` : "no education focus yet";
  const care = [
    c.guardian ? `guardian ${c.guardian.name}` : "no guardian",
    c.wetNurse ? `wet nurse ${c.wetNurse.name}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  let out = `- ${c.name} (${c.id}, ${c.female ? "F" : "M"} ${c.age}, ${c.relation}): ${focus}; ${care}
`;
  const traits = c.childhood.length ? c.childhood.join(", ") : "no childhood trait";
  const fit =
    c.fit === "good"
      ? `matches the focus (+20)`
      : c.fit === "bad"
        ? `clashes with the focus (-20)`
        : c.fit === "neutral"
          ? "neutral for the focus"
          : "";
  const better = c.affinity.filter((f) => f !== c.focus);
  out +=
    `  ${traits}${fit ? ` — ${fit}` : ""}` +
    (c.fit === "bad" && better.length ? `; better fit: ${better.join(", ")}` : "") +
    (c.fit === "neutral" && better.length ? `; would match: ${better.join(", ")}` : "") +
    (c.intelligence ? `; intelligence +${c.intelligence}` : "") +
    "\n";
  if (c.picks.length && c.focus)
    out +=
      `  best ${c.focus} educators: ` +
      c.picks
        .map(
          (p) =>
            `${p.person.name} ${p.value.toFixed(1)} (${c.focus} ${p.skill}, ${p.person.wards} wards)`,
        )
        .join(", ") +
      "\n";
  return out;
}

export function registerGuardiansTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "guardians",
    {
      title: "Guardians and Tutors",
      description:
        "Children at your court (under 16: grandchildren, young courtiers) with age, education focus, skills and current guardian, plus the child's childhood personality (charming, curious, rowdy, bossy, pensive) and whether it matches or clashes with the chosen focus (the game adds or subtracts 20 from the success weight), and the best courtiers to be each child's educator, scored as 0.4 x the focus skill + 0.2 x Learning + an intelligence bonus (an adult who is not imprisoned or incapable and has fewer than 2 wards). Also ranks your court for the three child-care court positions: court tutor, wet nurse and caravan master, using the game's aptitude formulas and validity rules (not the ruler's spouse; wet nurse: female, under 46, not a ruler, not close family, not devoted, commoner; landed tutors need Learning 12+; a position counts as a full-time job, so nobody holds two). Limits: it only ranks people already at your court. Hiring offers a pool of characters from the capital province only, and acceptance and cost are not in the save. The caravan master score leaves out the caravan's speed and safety terms; wet-nurse commoner status is only confirmed for characters with no dynasty, and clergy status is not checked. Skills include trait bonuses from the game files but not perks or artifacts.",
      inputSchema: {
        top: z
          .number()
          .int()
          .min(1)
          .max(15)
          .optional()
          .describe("candidates to list per court position (default 5)"),
        per_child: z
          .number()
          .int()
          .min(1)
          .max(6)
          .optional()
          .describe("guardian candidates to list per child (default 3)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ top, per_child }: { top?: number; per_child?: number }) => {
      const perChild = per_child ?? 3;
      const res = await cache.memoQuery(`guardians:${perChild}`, (q) => ({
        info: extractGuardians(q, cache.loc, cache.lookup, perChild),
      }));
      if ("error" in res) return { isError: true, content: [{ type: "text", text: res.error }] };
      const snap = await cache.get();
      if ("error" in snap) return { isError: true, content: [{ type: "text", text: snap.error }] };
      const { info } = res;
      if (!info) return { content: [{ type: "text", text: stamp(snap, "Player not found.") }] };

      let body = `# Guardians and tutors: ${info.children.length} children at court\n\n`;
      body += info.children.length
        ? (() => {
            const t = truncate(info.children, 30);
            return t.shown.map(childLine).join("") + t.note;
          })()
        : "No children at your court.\n";
      for (const r of info.roles) body += roleSection(r, top ?? 5);
      return { content: [{ type: "text", text: stamp(snap, body) }] };
    },
  );
}
