import { describe, expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { extractCompany } from "../src/extract/company.js";
import { renderCompany } from "../src/tools/company.js";

// Shapes mirror a real 1.21 merchant save (docs/save-schema.md, "Merchant company").
const MERCHANT = `
date=1066.9.15
played_character={ character=70086 player=1 }
living={
70086={
	alive_data={ gold={ value=50 } income=0.70875 influence={ currency=3.5 } }
	landed_data={
		government="merchant_government"
		trade_competitiveness=10
		barter_goods={ }
		balance=0.70875
		gold_expenses=0.08
	}
}
}
`;

const FEUDAL = `
played_character={ character=1 player=1 }
living={ 1={ landed_data={ government="feudal_government" } } }
`;

const read = <T>(gs: string, fn: (q: never) => T) =>
  queryGamestate(Buffer.from(gs), fn as never) as Promise<T>;

describe("extractCompany", () => {
  test("reads the company numbers", async () => {
    const c = await read(MERCHANT, extractCompany);
    expect(c).toMatchObject({
      government: "merchant_government",
      isMerchant: true,
      tradeCompetitiveness: 10,
      barterGoods: [],
      income: 0.70875,
      expenses: 0.08,
      balance: 0.70875,
      influence: 3.5,
    });
  });

  test("a non-merchant save yields nulls instead of throwing", async () => {
    const c = await read(FEUDAL, extractCompany);
    expect(c.isMerchant).toBe(false);
    expect(c.tradeCompetitiveness).toBeNull();
  });
});

describe("renderCompany", () => {
  test("states the data limits and points to the trade tool", async () => {
    const text = renderCompany(await read(MERCHANT, extractCompany));
    expect(text).toContain("# Company — merchant_government");
    expect(text).toContain("Trade competitiveness: 10");
    expect(text).toContain("Barter goods: none");
    expect(text).toContain("use the `trade` tool");
    expect(text).toContain("meaning unverified");
  });

  test("warns when the government is not a merchant company", async () => {
    const text = renderCompany(await read(FEUDAL, extractCompany));
    expect(text).toContain("not a merchant company");
    expect(text).toContain("Trade competitiveness: ?");
  });
});
