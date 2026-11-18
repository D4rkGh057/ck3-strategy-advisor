import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { block, stamp, truncate } from "../format.js";
import { extractRaids, type RaidArmy } from "../extract/raids.js";
import { errorResult, loadQuery, loadSnapshot } from "./kit.js";

// "pillage_intent_tribal" -> "pillage (tribal)"; "destruction_intent" -> "destruction".
function intentLabel(raw: string | null): string {
  if (!raw) return "no intent set";
  const m = /^(.+?)_intent(?:_(.+))?$/.exec(raw);
  return m ? (m[2] ? `${m[1]} (${m[2]})` : m[1]!) : raw;
}

function army(a: RaidArmy, withOwner: boolean): string {
  const men =
    a.men !== null ? `${a.men}${a.maxMen !== null ? `/${a.maxMen}` : ""} men` : "men unknown";
  const state = a.active
    ? `RAIDING, ${intentLabel(a.intent)}, progress ${a.progress ?? "?"}, loot ${a.loot ?? 0} gold`
    : "raid-capable, not raiding";
  const lines = [
    `- Army ${a.armyId}${withOwner ? ` — ${a.ownerName} (${a.ownerId})` : ""} — ${state}`,
    `  ${men}, supply ${a.supply ?? "?"}, province ${a.province ?? "?"}` +
      `${a.commanderName ? `, commander ${a.commanderName}` : ""}` +
      `${a.raised ? `, raised ${a.raised}` : ""}`,
  ];
  return lines.join("\n");
}

export function registerRaidsTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "raids",
    {
      title: "Raids",
      description:
        "Your raid-capable armies and whether each one is raiding right now: intent, raid progress, gold looted so " +
        "far, men, supply, province, commander and when it was raised. Also lists the other rulers' raids that are " +
        "running in the world, furthest along first. Limits: the save has no list of possible raid targets, no " +
        "estimated loot for a target and no sign of whether the raid mechanic is open to you; the owner of a raided " +
        "province is not stored either, so raids aimed at YOUR realm cannot be told apart from the rest; the " +
        "progress value is raw and its scale is not documented. Provinces are shown by id.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const res = await loadQuery(cache, "raids", (q) => extractRaids(q));
      if (!res.ok) return errorResult(res.error);
      const snapLoad = await loadSnapshot(cache);
      if (!snapLoad.ok) return errorResult(snapLoad.error);
      const snap = snapLoad.value;

      const raiding = res.value.mine.filter((a) => a.active).length;
      let body = `# Your raid armies: ${res.value.mine.length} (${raiding} raiding)\n\n`;
      if (res.value.mine.length === 0) body += "You own no raid-capable army.\n";
      else body += block(res.value.mine.map((a) => army(a, false)));

      body += `\n# Other rulers' active raids: ${res.value.others.length}\n\n`;
      if (res.value.others.length === 0) body += "None running.\n";
      else {
        const t = truncate(res.value.others, 15);
        body += block(t.shown.map((a) => army(a, true))) + t.note;
      }
      body += `\n_${res.value.worldActive} raids are active in the whole save._\n`;
      return { content: [{ type: "text", text: stamp(snap, body) }] };
    },
  );
}
