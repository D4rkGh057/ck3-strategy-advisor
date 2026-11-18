import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "../src/snapshot.js";
import { Localizer } from "../src/localization.js";
import { registerSuccessionTool } from "../src/tools/succession.js";
const GS = readFileSync(fileURLToPath(new URL("./fixtures/mini-gamestate.txt", import.meta.url)));
test("extracts heirs, laws, and claimants", async () => {
  const s = (await buildSnapshot(GS, new Localizer(null))).succession;
  expect(s.primaryTitle).toBe("The Holy Roman Empire");
  expect(s.successionLaw).toBe("single_heir_succession_law");
  expect(s.genderLaw).toBe("male_preference_law");
  expect(s.heirs[0]).toEqual({ id: 22222, name: "Adela" });
  expect(s.designatedHeir).toEqual({ id: 40000, name: "Causantin" });
  expect(s.claimants.map((c) => c.id)).toContain(22222);
});

async function renderSuccession(succession: object) {
  const snap = { date: "1118-10-02", parsedAt: Date.now(), succession } as any;
  let handler: any;
  const server = {
    registerTool: (_name: string, _cfg: any, h: any) => {
      handler = h;
    },
  } as any;
  registerSuccessionTool(server, { get: async () => snap } as any);
  return (await handler({})).content[0].text as string;
}

const base = {
  primaryTitle: "Ireland",
  primaryTitleId: 1,
  successionLaw: "Confederate Partition",
  genderLaw: "Male Preference",
  totalHeirs: 2,
  claimants: [],
  totalClaimants: 0,
};

test("tool marks the designated heir by id, not the first list entry", async () => {
  const text = await renderSuccession({
    ...base,
    designatedHeir: { id: 3, name: "Simon" },
    heirs: [
      { id: 1, name: "Daniel" },
      { id: 3, name: "Simon" },
    ],
  });
  expect(text).toContain("- Designated heir: Simon (3)");
  expect(text).toContain("2. Simon (3) <- designated heir");
  expect(text).not.toContain("1. Daniel (1) <-");
  expect(text).not.toContain("primary heir");
});

test("tool says so when the save has no designated heir", async () => {
  const text = await renderSuccession({
    ...base,
    designatedHeir: null,
    heirs: [{ id: 1, name: "Daniel" }],
  });
  expect(text).toContain("- Designated heir: not stored in this save");
  expect(text).not.toContain("<- designated heir");
});

import { queryGamestate } from "../src/parser.js";
import { extractSuccession } from "../src/extract/succession.js";

// Houses 100 and 200 are one dynasty (7); house 300 is another (8).
const dynastyGs = (own: string) => `
played_character={ character=1 player=1 }
landed_titles={ landed_titles={ 10={ key="x_c_merchant_a" name="Company" holder=1 } } }
dynasties={ dynasty_house={ 100={ dynasty=7 } 200={ dynasty=7 } 300={ dynasty=8 } } }
living={
1={ first_name="Me" ${own} landed_data={ domain={ 10 } succession={ 2 3 4 } laws={ "company_succession_law" "male_preference_law" } } }
2={ first_name="Cousin" dynasty_house=200 }
3={ first_name="Stranger" dynasty_house=300 }
4={ first_name="Lowborn" }
}
`;
const extract = (gs: string) =>
  queryGamestate(Buffer.from(gs), (q) => extractSuccession(q, new Localizer(null)));

test("heirs of your dynasty are found through the house, not only the same house", async () => {
  expect((await extract(dynastyGs("dynasty_house=100"))).dynastyHeirIds).toEqual([2]);
});

test("a list with nobody of your dynasty gives an empty list; unknown own dynasty gives null", async () => {
  expect((await extract(dynastyGs("dynasty_house=300"))).dynastyHeirIds).toEqual([3]);
  const none = dynastyGs("dynasty_house=100").replace("dynasty_house=200", "dynasty_house=300");
  expect((await extract(none)).dynastyHeirIds).toEqual([]);
  expect((await extract(dynastyGs(""))).dynastyHeirIds).toBeNull();
});

const withDynasty = (dynastyHeirIds: number[] | null) => ({
  ...base,
  designatedHeir: null,
  heirs: [
    { id: 1, name: "Daniel" },
    { id: 3, name: "Simon" },
  ],
  dynastyHeirIds,
});

test("tool tags heirs of your dynasty", async () => {
  const text = await renderSuccession(withDynasty([3]));
  expect(text).toContain("2. Simon (3) (your dynasty)");
  expect(text).not.toContain("1. Daniel (1) (your dynasty)");
  expect(text).not.toContain("None of these heirs");
});

test("tool explains the no-heir alert when nobody is of your dynasty", async () => {
  expect(await renderSuccession(withDynasty([]))).toContain(
    "None of these heirs is of your dynasty",
  );
});

test("tool says nothing about dynasty when it cannot be read", async () => {
  const text = await renderSuccession(withDynasty(null));
  expect(text).not.toContain("your dynasty");
});
