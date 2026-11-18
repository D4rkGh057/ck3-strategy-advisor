#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveConfig, discoverSaveDir, discoverGameDir } from "./config.js";
import { SaveFileSource } from "./source.js";
import { SnapshotCache } from "./cache.js";
import { Localizer } from "./localization.js";
import { GameData } from "./gameData.js";
import { modLocalizationDirs } from "./mods.js";
import { dirname } from "node:path";
import { registerAllTools } from "./tools/index.js";
import { registerAllPrompts } from "./prompts/index.js";
import { HistoryStore, defaultHistoryDir } from "./history.js";
import { SERVER_VERSION } from "./version.js";

async function main() {
  const cfg = resolveConfig();
  const saveDir = cfg.saveDir ?? (await discoverSaveDir());
  if (!saveDir) {
    console.error("No CK3 save dir found. Set CK3_SAVE_DIR.");
    process.exit(1);
  }
  const gameDir = cfg.gameDir ?? (await discoverGameDir());
  const cache = new SnapshotCache(
    new SaveFileSource({ saveDir }),
    new Localizer(gameDir, modLocalizationDirs(dirname(saveDir))),
    new GameData(gameDir),
    new HistoryStore(defaultHistoryDir()),
  );
  const server = new McpServer(
    { name: "ck3-strategy-advisor", version: SERVER_VERSION },
    {
      instructions:
        "Tools report the player's CK3 realm from their latest save. Each response is stamped with the save's in-game date and age.",
    },
  );
  registerAllTools(server, cache);
  registerAllPrompts(server);
  await server.connect(new StdioServerTransport());
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
