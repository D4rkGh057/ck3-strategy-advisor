import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { stamp, truncate } from "../format.js";
import { errorResult, loadSnapshot } from "./kit.js";

export function registerSuccessionTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "succession",
    {
      title: "Succession",
      description:
        "Designated heir (as the game shows it) and the ordered succession list for the player's primary title, plus succession & gender laws and rival claimants. Heirs of your own dynasty are tagged; if none is, it says so (the game's \"no heir\" alert asks for one). " +
        "Note: list order is not the designated heir under partition laws. CK3 does not store a partition preview, so which heir inherits which title is not simulated.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const snapLoad = await loadSnapshot(cache);
      if (!snapLoad.ok) return errorResult(snapLoad.error);
      const snap = snapLoad.value;
      const s = snap.succession;

      let body = `# Succession — ${s.primaryTitle}\n`;
      body += `- Law: ${s.successionLaw} / ${s.genderLaw}\n`;

      const { shown: shownHeirs, note: heirNote } = truncate(s.heirs, 6);
      const heirLabel =
        shownHeirs.length < s.totalHeirs
          ? `showing ${shownHeirs.length} of ${s.totalHeirs}`
          : String(s.totalHeirs);
      const dh = s.designatedHeir;
      body += dh
        ? `- Designated heir: ${dh.name} (${dh.id})\n`
        : `- Designated heir: not stored in this save\n`;
      body += `## Succession order (${heirLabel})\n`;
      shownHeirs.forEach((h, i) => {
        const tag = dh && h.id === dh.id ? " <- designated heir" : "";
        const own = s.dynastyHeirIds?.includes(h.id) ? " (your dynasty)" : "";
        body += `${i + 1}. ${h.name} (${h.id})${own}${tag}\n`;
      });
      body += heirNote;
      // The game's "no heir" alert fires when no title heir shares your dynasty, even if the
      // succession list is not empty.
      if (s.dynastyHeirIds && s.totalHeirs > 0 && s.dynastyHeirIds.length === 0)
        body +=
          '- None of these heirs is of your dynasty: the game\'s "no heir" alert asks for a title heir of your dynasty.\n';

      const { shown: shownClaim, note: claimNote } = truncate(s.claimants, 6);
      if (shownClaim.length === 0) {
        body += `\n## Rival claimants (0)\nNone.`;
      } else {
        body += `\n## Rival claimants (${s.totalClaimants})\n`;
        for (const c of shownClaim) {
          body += `- ${c.name} (${c.id})\n`;
        }
        body += claimNote;
      }

      return { content: [{ type: "text", text: stamp(snap, body) }] };
    },
  );
}
