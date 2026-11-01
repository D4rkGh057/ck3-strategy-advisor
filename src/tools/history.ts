import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { stamp } from "../format.js";
import { renderHistory } from "../history.js";

export function registerHistoryTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "history",
    {
      title: "Playthrough History",
      description:
        "Timeline of this playthrough: gold, lifetime prestige, piety, income, military strength, titles and vassals " +
        "over time, plus the change from the first to the last point. Points exist only for saves this server has " +
        "already read (one per save, keyed by the campaign id), so gaps mean the save was never queried. Tracks " +
        "realm totals only, not per-character data.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(2)
          .max(100)
          .optional()
          .describe("Max rows to show (default 20); longer histories are evenly down-sampled."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit }) => {
      const snap = await cache.get();
      if ("error" in snap) return { isError: true, content: [{ type: "text", text: snap.error }] };
      const { id } = snap.playthrough;
      if (!cache.history || !id) {
        return {
          content: [
            { type: "text", text: stamp(snap, "History is unavailable: this save has no playthrough id or history storage is off.") },
          ],
        };
      }
      // The recording kicked off by the build is fire-and-forget; record again so the table
      // always includes the current save (idempotent by timer).
      await cache.history.record(snap).catch(() => {});
      const entries = await cache.history.read(id);
      return { content: [{ type: "text", text: stamp(snap, renderHistory(entries, limit ?? 20)) }] };
    },
  );
}
