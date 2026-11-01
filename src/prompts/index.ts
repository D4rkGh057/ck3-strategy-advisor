import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTurnReviewPrompt } from "./turnReview.js";

export function registerAllPrompts(server: McpServer) {
  registerTurnReviewPrompt(server);
}
