import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTurnReviewPrompt } from "./turnReview.js";
import { registerSuccessionPlanPrompt } from "./successionPlan.js";

export function registerAllPrompts(server: McpServer) {
  registerTurnReviewPrompt(server);
  registerSuccessionPlanPrompt(server);
}
