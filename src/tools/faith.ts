import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { extractFaith } from "../extract/faith.js";
import { READ_ONLY, errorResult, loadQuery, loadSnapshot, stamped } from "./kit.js";

export function registerFaithTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "faith",
    {
      title: "Faith",
      description:
        "The tenets and doctrines of your own faith as practised by your character: the rite you belong to and the base faith it descends from, with the doctrines your rite adds or drops compared to that base faith. Doctrine and tenet names are localized when the game files are available, otherwise derived from their keys. Does not include holy sites, clergy, fervor or other faiths; use game_entry to look up what a doctrine or tenet does.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const snap = await loadSnapshot(cache);
      if (!snap.ok) return errorResult(snap.error);
      const res = await loadQuery(cache, "faith", (q) => extractFaith(q, cache.loc, cache.lookup));
      if (!res.ok) return errorResult(res.error);
      const f = res.value;

      if (!f.riteName && f.tenets.length === 0 && f.doctrines.length === 0)
        return stamped(snap.value, "No faith data found for your character in this save.");

      let body = `# Faith: ${f.riteName ?? "unknown"}`;
      if (f.faithName) body += ` (rite of ${f.faithName})`;
      body += "\n";
      if (f.tenets.length) body += `\n## Tenets\n${f.tenets.map((t) => `- ${t}`).join("\n")}\n`;
      if (f.doctrines.length)
        body += `\n## Doctrines\n${f.doctrines.map((d) => `- ${d}`).join("\n")}\n`;
      if (f.addedDoctrines.length || f.removedDoctrines.length) {
        body += `\n## Rite vs ${f.faithName ?? "base faith"}\n`;
        if (f.addedDoctrines.length) body += `- Adds: ${f.addedDoctrines.join("; ")}\n`;
        if (f.removedDoctrines.length) body += `- Drops: ${f.removedDoctrines.join("; ")}\n`;
      }
      return stamped(snap.value, body);
    },
  );
}
