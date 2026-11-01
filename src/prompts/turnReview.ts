import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Pure text builder, kept separate from registration so it can be unit-tested. */
export function turnReviewText(focus?: string): string {
  const topic = focus?.trim();
  return `Run a turn review of my Crusader Kings III realm using the ck3-advisor tools. Read-only: never suggest the save was or can be modified by you.

## 1. Gather (one parallel batch)
Call these together, they are independent: \`realm_overview\`, \`alerts\`, \`succession\`, \`factions\`, \`military\`, \`history\`.
If any call returns an error (no save, Ironman, unreadable), report that error verbatim and stop.

## 2. Drill down only where the data points
Do NOT call every tool. Follow up only on a trigger:
- A faction is near its threshold, or the leader is a known vassal -> \`vassals\` (and \`character\` on the leader).
- The heir is missing, a minor, unmarried, or the succession list holds a rival -> \`family\` or \`marriage_candidates\`.
- Alerts mention council seats or courtiers -> \`council\`.
- Gold is low or income negative -> \`domain\`.
- A neighbour appears hostile in the data -> \`diplomacy\` or \`foreign_realm\`.
Cap the follow-ups at 4 calls.

## 3. Report (short, prioritised, no raw dumps)
1. **Verdict**: one line on the realm's state, with the save date from the stamp.
2. **Do now** (max 3): concrete actions ordered by urgency. Name the characters/titles involved.
3. **Watch** (max 3): risks that are not urgent yet, each with the number that triggers it.
4. **Trend**: one line from \`history\` (gold, prestige, military, titles) versus the previous point. If there is no earlier point, say so.
${topic ? `\nExtra focus requested by the player: "${topic}". Weigh it first, but still surface any critical risk.\n` : ""}
## Honesty limits (hard rules)
The save does NOT store per-character men-at-arms, strong/weak claims, or computed opinion totals. Never state them as fact. If a recommendation depends on something the tools do not expose (faith rules, secrets, relationships, council desires), say it must be checked in-game.
Monthly income from the tools is GROSS: monthly expenses are not in the save, so never report it as net gold per month. Say the net must be read in-game.
Cite the figure behind every claim. If the data is ambiguous, say so instead of guessing.`;
}

export function registerTurnReviewPrompt(server: McpServer) {
  server.registerPrompt(
    "ck3-turn-review",
    {
      title: "CK3 turn review",
      description:
        "Prioritised review of the player's realm from the latest save: what to do now, what to watch, and the recent trend. Chains realm_overview, alerts, succession, factions, military and history, then drills down only where needed.",
      argsSchema: {
        focus: z
          .string()
          .optional()
          .describe("Optional concern to weigh first, e.g. 'war with Wessex' or 'my heir'."),
      },
    },
    ({ focus }) => ({
      messages: [{ role: "user", content: { type: "text", text: turnReviewText(focus) } }],
    }),
  );
}
