import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SnapshotCache } from "../cache.js";
import { extractFamily, type Relative } from "../extract/family.js";
import { block, bullet } from "../format.js";
import { READ_ONLY, run } from "./kit.js";

function kin(r: Relative): string {
  const status = r.alive ? (r.age !== null ? `age ${r.age}` : "alive") : "dead";
  return `${r.name} (${r.id}, ${r.female ? "F" : "M"}, ${status})`;
}

export function registerFamilyTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "family",
    {
      title: "Family",
      description:
        "Family tree around a character (default: you): parents, spouses, betrothals, children, and siblings with " +
        "ages and alive/dead. For you it also labels the first heirs in the succession line by kinship " +
        "(child, sibling, nephew, cousin…) — use it to see who inherits and how they relate to you.",
      inputSchema: {
        id: z.number().optional().describe("character id (omit for the player)"),
      },
      annotations: READ_ONLY,
    },
    async ({ id }: { id?: number }) =>
      run(
        cache,
        `family:${id ?? ""}`,
        (q, shared) => extractFamily(q, id, undefined, shared),
        (f) => {
          if (!f) return `No character with id ${id}.`;
          const section = (title: string, list: Relative[], withRel = false) =>
            `## ${title} (${list.length})\n` +
            (list.length === 0
              ? "None.\n"
              : block(list.map((r) => bullet(`${kin(r)}${withRel ? ` — ${r.relation}` : ""}`))));
          let body = `# Family of ${f.subject.name} (${f.subject.id}, age ${f.subject.age ?? "?"})\n`;
          body += section("Parents", f.parents);
          body += section("Spouses", f.spouses);
          if (f.concubines.length) body += section("Concubines", f.concubines);
          if (f.concubineOf.length) body += section("Concubine of", f.concubineOf);
          if (f.betrothed.length) body += section("Betrothed", f.betrothed);
          if (f.formerSpouses.length) body += section("Former spouses", f.formerSpouses);
          body += section("Children", f.children);
          body += section("Siblings", f.siblings, true);
          if (f.heirs.length) {
            body += `## Succession line (first ${f.heirs.length})\n`;
            f.heirs.forEach((h, i) => (body += `${i + 1}. ${kin(h)} — ${h.relation}\n`));
          }
          return body;
        },
      ),
  );
}
