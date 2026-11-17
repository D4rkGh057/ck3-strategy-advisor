import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Pure text builder, kept separate from registration so it can be unit-tested. */
export function successionPlanText(focus?: string): string {
  const topic = focus?.trim();
  return `Plan the succession of my Crusader Kings III realm using the ck3-advisor tools. Read-only: you cannot change the game or the save. Answer in the player's language.

## 1. Gather (one parallel batch)
Call these together, they are independent: \`realm_overview\`, \`succession\`, \`family\`.
If \`realm_overview\` returns an error (no save, Ironman, unreadable), report that error verbatim and stop.
If any other call fails, note the gap in the report and continue with the rest.
If the save stamp shows the save is old, say so first: the advice may be outdated.

## 2. Drill down only where the data points
Do NOT call every tool. Follow up only on a trigger:
- The heir or another child in the line is a minor with no clear guardian -> \`guardians\`.
- A rival claimant appears in the succession list or the rival claimants, or the next in line is a distant relative -> \`character\` on that person.
- A claimant to my titles is held in my dungeon, or my own heir is imprisoned -> \`prisoners\`.
- The heir is unmarried and an adult: call \`marriage_candidates\` (slow, about 15 s) only if \`family\` shows an unmarried adult heir.
- No suitable spouse, or no capable courtier to raise the line -> \`court_candidates\`.
- A faction exists that backs a claimant -> \`factions\`.
Cap the follow-ups at 4 calls. If more triggers fire, prioritise: risk of losing the throne or titles > the heir's readiness > marriage > extras.

## 3. Report (short, prioritised, no raw dumps)
1. **Verdict**: one line on how safe the succession is, with the save date from the stamp.
2. **Who inherits**: the designated heir and the next two in line, each with age and kinship to me, and what the succession and gender laws imply.
3. **Do now** (max 3): concrete actions ordered by urgency (guardian, marriage, imprisoned claimant). Name the characters involved.
4. **Watch** (max 3): risks that are not urgent yet, each with the number that triggers it (a minor's age, a claimant's rank).
5. **Check in game**: what the tools cannot show and I must confirm myself.
${topic ? `\nExtra focus requested by the player: "${topic}". Weigh it first, but still surface any critical risk.\n` : ""}
## Honesty limits (hard rules)
The save does NOT store which heir inherits which title under a partition law, strong/weak claims, or computed opinion totals. Never state them as fact. The list order from \`succession\` is not the designated heir under partition laws.
\`marriage_candidates\` does not include the acceptance chance shown in the game: tell me to check it in the marriage window.
If a recommendation depends on something the tools do not expose, say it must be checked in-game.
Cite the figure behind every claim. If the data is ambiguous, say so instead of guessing.`;
}

export function registerSuccessionPlanPrompt(server: McpServer) {
  server.registerPrompt(
    "ck3-succession-plan",
    {
      title: "CK3 succession plan",
      description:
        "Succession check from the latest save: who inherits, how safe the line is, and what to do about heirs, guardians, marriage and rival claimants. Chains realm_overview, succession and family, then drills down only where needed.",
      argsSchema: {
        focus: z
          .string()
          .optional()
          .describe("Optional concern to weigh first, e.g. 'my second son' or 'the claimant in my dungeon'."),
      },
    },
    ({ focus }) => ({
      messages: [{ role: "user", content: { type: "text", text: successionPlanText(focus) } }],
    }),
  );
}
