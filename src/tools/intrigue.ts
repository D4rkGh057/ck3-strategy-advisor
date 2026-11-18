import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { extractIntrigue } from "../extract/intrigue.js";
import { READ_ONLY, run } from "./kit.js";

export function registerIntrigueTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "intrigue",
    {
      title: "Intrigue",
      description:
        "Secrets and hooks as the player can see them: other people's secrets you have discovered, your own " +
        "secrets and how many people know each, hooks you hold over others, and hooks others hold over you. " +
        "Does not reveal secrets you have not discovered.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run(
        cache,
        "intrigue",
        (q) => extractIntrigue(q, cache.loc),
        (i) => {
          let body = `# Secrets you know (${i.knownSecrets.length})\n`;
          if (i.knownSecrets.length === 0) body += "None.\n";
          for (const s of i.knownSecrets)
            body += `- ${s.ownerName} (${s.ownerId}): ${s.type}${s.targetName ? ` (with ${s.targetName})` : ""}\n`;
          body += `## Your own secrets (${i.ownSecrets.length})\n`;
          if (i.ownSecrets.length === 0) body += "None.\n";
          for (const s of i.ownSecrets)
            body += `- ${s.type}${s.targetName ? ` (with ${s.targetName})` : ""} — known by ${s.knownBy} other(s)\n`;
          body += `## Hooks you hold (${i.hooksHeld.length})\n`;
          if (i.hooksHeld.length === 0) body += "None.\n";
          for (const h of i.hooksHeld) body += `- on ${h.otherName} (${h.otherId}): ${h.type}\n`;
          body += `## Hooks on you (${i.hooksAgainst.length})\n`;
          if (i.hooksAgainst.length === 0) body += "None.\n";
          for (const h of i.hooksAgainst) body += `- by ${h.otherName} (${h.otherId}): ${h.type}\n`;
          return body;
        },
      ),
  );
}
