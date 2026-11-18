import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { registerOverview } from "./overview.js";
import { registerCharacterTools } from "./character.js";
import { registerMilitaryTool } from "./military.js";
import { registerSuccessionTool } from "./succession.js";
import { registerDiplomacyTool } from "./diplomacy.js";
import { registerVassalsTool } from "./vassals.js";
import { registerFactionsTool } from "./factions.js";
import { registerExpansionTool } from "./expansion.js";
import { registerTitlesTool } from "./titles.js";
import { registerForeignRealmTool } from "./foreignRealm.js";
import { registerExtendedTools } from "./extended.js";
import { registerGameLookupTools } from "./gameLookup.js";
import { registerCouncilTool } from "./council.js";
import { registerTargetsTool } from "./targets.js";
import { registerCourtiersTool } from "./courtiers.js";
import { registerHistoryTool } from "./history.js";
import { registerFaithTool } from "./faith.js";
import { registerGuardiansTool } from "./guardians.js";
import { registerPrisonersTool } from "./prisoners.js";
import { registerRaidsTool } from "./raids.js";
import { registerTradeTool } from "./trade.js";
import { registerTradeSuggestionsTool } from "./tradeSuggestions.js";

type Registered = { content: { type: string; text?: string }[] };

// Tool output is built from the save's raw names; decode the escaped ones ("BeorhtflE_d" ->
// "Beorhtflæd") in one place instead of in every extractor. The tools get a view of the server
// whose registerTool decodes every reply; the real server is never modified.
function decodingServer(server: McpServer, cache: SnapshotCache): McpServer {
  const registerTool = ((
    name: string,
    config: unknown,
    cb: (...a: unknown[]) => Promise<Registered>,
  ) =>
    (server.registerTool as (...a: unknown[]) => unknown).call(
      server,
      name,
      config,
      async (...args: unknown[]) => {
        const result = await cb(...args);
        return {
          ...result,
          content: result.content.map((c) =>
            c.type === "text" && typeof c.text === "string"
              ? { ...c, text: cache.loc.decodeNames(c.text) }
              : c,
          ),
        };
      },
    )) as McpServer["registerTool"];
  return Object.create(server, { registerTool: { value: registerTool } }) as McpServer;
}

export function registerAllTools(server: McpServer, cache: SnapshotCache) {
  registerEach(decodingServer(server, cache), cache);
}

function registerEach(server: McpServer, cache: SnapshotCache) {
  registerOverview(server, cache);
  registerCharacterTools(server, cache);
  registerMilitaryTool(server, cache);
  registerSuccessionTool(server, cache);
  registerDiplomacyTool(server, cache);
  registerVassalsTool(server, cache);
  registerFactionsTool(server, cache);
  registerExpansionTool(server, cache);
  registerTitlesTool(server, cache);
  registerForeignRealmTool(server, cache);
  registerExtendedTools(server, cache);
  registerGameLookupTools(server, cache);
  registerCouncilTool(server, cache);
  registerTargetsTool(server, cache);
  registerCourtiersTool(server, cache);
  registerHistoryTool(server, cache);
  registerFaithTool(server, cache);
  registerGuardiansTool(server, cache);
  registerPrisonersTool(server, cache);
  registerTradeTool(server, cache);
  registerTradeSuggestionsTool(server, cache);
  registerRaidsTool(server, cache);
}
