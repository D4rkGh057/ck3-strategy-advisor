import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { truncate } from "../format.js";
import { extractAlerts } from "../extract/alerts.js";
import { READ_ONLY, run } from "./kit.js";

export function registerAlertsTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "alerts",
    {
      title: "Alerts",
      description:
        "The game's own 'important actions' nudges for the player (the top-right alert icons): e.g. you or your " +
        "heir are unmarried, family members can marry, an unused casus belli, unstationed men-at-arms, a lifestyle " +
        "to pick, hostages, empty accolade slots. Each lists the characters/titles it concerns. Good second call " +
        "after `realm_overview` to see what needs attention.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run(
        cache,
        "alerts",
        (q) => extractAlerts(q, cache.loc),
        (alerts) => {
          if (alerts.length === 0) return "# Alerts\nNothing flagged by the game.";
          let body = `# Alerts (${alerts.length})\n`;
          for (const a of alerts) {
            const label = a.label === a.type ? a.type : `${a.label} (${a.type})`;
            body += `- ${label}\n`;
            const { shown, note } = truncate(a.targets, 8);
            for (const t of shown) body += `  - ${t.name} (${t.kind} ${t.id})\n`;
            if (note) body += `  ${note.trim()}\n`;
          }
          return body;
        },
      ),
  );
}
