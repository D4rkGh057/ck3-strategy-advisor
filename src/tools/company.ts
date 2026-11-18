import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { extractCompany, type CompanyInfo } from "../extract/company.js";
import { READ_ONLY, run } from "./kit.js";

const n = (v: number | null, digits = 2) => (v === null ? "?" : v.toFixed(digits));

export function renderCompany(c: CompanyInfo): string {
  let body = `# Company — ${c.government ?? "unknown government"}\n`;
  if (!c.isMerchant)
    body += "Your government is not a merchant company; the fields below may be missing.\n";
  body +=
    `- Trade competitiveness: ${n(c.tradeCompetitiveness, 0)}\n` +
    `- Influence: ${n(c.influence)}\n` +
    `- Income: ${n(c.income)}/month (gross) | Expenses: ${n(c.expenses)} (save field gold_expenses, meaning unverified)\n` +
    `- Balance: ${n(c.balance)} (save field, meaning unverified)\n`;
  body += c.barterGoods.length
    ? `- Barter goods: ${c.barterGoods.map(([k, v]) => `${k}=${v}`).join(", ")}\n`
    : "- Barter goods: none\n";
  body += "Routes and trade expertise: use the `trade` tool.\n";
  return body;
}

export function registerCompanyTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "company",
    {
      title: "Company",
      description:
        "Merchant company status: government, trade competitiveness, influence, income and expenses, and barter goods. " +
        "For your routes and trade expertise use `trade`. Data limits: the save does not store a net monthly figure (balance and " +
        "gold_expenses are shown as stored, meaning unverified), and the shape of non-empty barter goods is not verified.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => run(cache, "company", extractCompany, renderCompany),
  );
}
