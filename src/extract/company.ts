import type { Query } from "../parser.js";
import { num, playerIdOf } from "./common.js";

export interface CompanyInfo {
  government: string | null;
  isMerchant: boolean;
  tradeCompetitiveness: number | null;
  /** Barter goods as stored; the value is rendered as-is because its shape is only verified when empty. */
  barterGoods: [string, string][];
  income: number | null;
  expenses: number | null;
  /** `landed_data/balance`: stored by the save, meaning unverified. */
  balance: number | null;
  influence: number | null;
}

// A merchant company's own numbers, from /living/{player}/landed_data and alive_data
// (docs/save-schema.md). Routes and trade expertise belong to the `trade` tool.
export function extractCompany(q: Query): CompanyInfo {
  const pid = playerIdOf(q);
  const landed = `/living/${pid}/landed_data`;
  const alive = `/living/${pid}/alive_data`;

  const government = q.at(`${landed}/government`);
  const goods = q.at(`${landed}/barter_goods`);
  const barterGoods: [string, string][] =
    goods && typeof goods === "object" && !Array.isArray(goods)
      ? Object.entries(goods as Record<string, unknown>).map(([k, v]) => [k, JSON.stringify(v)])
      : [];

  const influence = q.at(`${alive}/influence`) as Record<string, unknown> | undefined;

  return {
    government: typeof government === "string" ? government : null,
    isMerchant: government === "merchant_government",
    tradeCompetitiveness: num(q.at(`${landed}/trade_competitiveness`)),
    barterGoods,
    income: num(q.at(`${alive}/income`)),
    expenses: num(q.at(`${landed}/gold_expenses`)),
    balance: num(q.at(`${landed}/balance`)),
    influence: num(influence?.["currency"]),
  };
}
