import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractPrisoners } from "../src/extract/prisoners.js";

// Player 1 holds title 11 (a county). Prisoners held by 1: 2 (foreign ruler), 3 (own son),
// 4 (claimant on title 11), 5 (courtier of 9), 6 (nobody in particular). Held by 9: 7 (player's
// brother) and 8 (stranger). 9 is a ruler.
const GS = Buffer.from(`
traits_lookup={ "brave" }
date=1066.6.1
played_character={ character=1 player=1 }
landed_titles={ landed_titles={
  11={ key="c_ours" name="Ours" holder=1 }
  12={ key="d_theirs" name="Theirs" holder=2 }
  13={ key="k_theirs" name="Their Kingdom" holder=2 }
} }
living={
1={ first_name="Ruler" birth=1020.1.1 dynasty_house=1 skill={ 5 5 5 5 5 5 } landed_data={ domain={ 11 } succession={ 3 } } family_data={ child={ 3 } } alive_data={ health=6 } }
2={ first_name="Duke" birth=1030.1.1 dynasty_house=2 skill={ 7 5 5 5 5 5 } traits={ 0 }
   landed_data={ domain={ 12 13 } current_strength=900.5 } family_data={ }
   alive_data={ health=5 gold={ value=120.4 } prison_data={ imprisoner=1 date=1060.1.1 imprison_type_date=1060.1.1 type=dungeon } } }
3={ first_name="Son" birth=1045.1.1 dynasty_house=1 skill={ 5 5 5 5 5 5 }
   alive_data={ health=6 prison_data={ imprisoner=1 date=1065.1.1 type=house_arrest } } }
4={ first_name="Claimant" birth=1035.1.1 dynasty_house=3 skill={ 5 5 5 5 5 5 }
   alive_data={ claim={ { title=11 } { title=99 } } prison_data={ imprisoner=1 date=1062.1.1 type=dungeon } } }
5={ first_name="Courtier" birth=1035.1.1 dynasty_house=4 skill={ 5 5 5 5 5 5 } court_data={ employer=9 }
   alive_data={ prison_data={ imprisoner=1 date=1064.1.1 type=house_arrest } } }
6={ first_name="Nobody" birth=1035.1.1 dynasty_house=5 skill={ 5 5 5 5 5 5 }
   alive_data={ prison_data={ imprisoner=1 date=1066.1.1 type=house_arrest } } }
7={ first_name="Brother" birth=1022.1.1 dynasty_house=1 skill={ 5 5 5 5 5 5 }
   alive_data={ prison_data={ imprisoner=9 date=1063.1.1 type=dungeon } } }
8={ first_name="Stranger" birth=1022.1.1 dynasty_house=6 skill={ 5 5 5 5 5 5 }
   alive_data={ prison_data={ imprisoner=9 date=1063.1.1 type=dungeon } } }
9={ first_name="Jailer" birth=1025.1.1 dynasty_house=7 skill={ 5 5 5 5 5 5 } landed_data={ domain={ 11 } } }
}
`);
// Parents of 1 are 20, who also parent 7 so 7 reads as a sibling.
const WITH_PARENTS = Buffer.from(
  GS.toString("utf8")
    .replace(
      "family_data={ child={ 3 } } alive_data={ health=6 } }",
      "family_data={ child={ 3 } } alive_data={ health=6 } }\n20={ first_name=\"Parent\" birth=1000.1.1 skill={ 5 5 5 5 5 5 } family_data={ child={ 1 7 } } }",
    ),
);

const run = (gs = WITH_PARENTS) =>
  queryGamestate(gs, (q) => extractPrisoners(q, new Localizer(null), null))!;

test("lists only the prisoners the player holds, longest held first", async () => {
  const r = (await run())!;
  expect(r.held.map((p) => p.id)).toEqual([2, 4, 5, 3, 6]);
  expect(r.worldTotal).toBe(7);
});

test("reads type, dates and years held from prison_data", async () => {
  const r = (await run())!;
  const duke = r.held.find((p) => p.id === 2)!;
  expect(duke.type).toBe("dungeon");
  expect(duke.since).toBe("1060.1.1");
  expect(duke.years).toBe(6);
});

test("a ruler shows title tier, army and gold and gets a ransom lead", async () => {
  const duke = (await run())!.held.find((p) => p.id === 2)!;
  expect(duke.ruler).toEqual({ titles: 2, topTier: "kingdom", strength: 900.5, gold: 120.4 });
  expect(duke.leads.join(" ")).toMatch(/ransom candidate/);
});

test("close kin get a release/marry lead instead of a ransom lead, and heirs are flagged", async () => {
  const son = (await run())!.held.find((p) => p.id === 3)!;
  expect(son.kinship).toBe("child");
  expect(son.isHeir).toBe(true);
  expect(son.leads.join(" ")).toMatch(/release or marriage/);
  expect(son.leads.join(" ")).not.toMatch(/ransom candidate/);
});

test("a claim on one of the player's titles is reported, others are ignored", async () => {
  const c = (await run())!.held.find((p) => p.id === 4)!;
  expect(c.claimsOnYou).toEqual(["Ours"]);
  expect(c.leads[0]).toMatch(/Holds a claim on your Ours/);
});

test("a courtier points to the court that would pay; a nobody gets the no-leverage lead", async () => {
  const r = (await run())!;
  const courtier = r.held.find((p) => p.id === 5)!;
  expect(courtier.court?.id).toBe(9);
  expect(courtier.leads.join(" ")).toMatch(/natural buyer/);
  expect(r.held.find((p) => p.id === 6)!.leads.join(" ")).toMatch(/no leverage/);
});

test("close kin held by other rulers are listed, strangers are not", async () => {
  const r = (await run())!;
  expect(r.kinHeldByOthers.map((p) => p.id)).toEqual([7]);
  expect(r.kinHeldByOthers[0]!.kinship).toBe("sibling");
  expect(r.kinHeldByOthers[0]!.imprisonerId).toBe(9);
});

test("flags the player when they are the prisoner", async () => {
  const gs = Buffer.from(
    WITH_PARENTS.toString("utf8").replace(
      "landed_data={ domain={ 11 } succession={ 3 } } family_data={ child={ 3 } } alive_data={ health=6 }",
      "landed_data={ domain={ 11 } succession={ 3 } } family_data={ child={ 3 } } alive_data={ health=6 prison_data={ imprisoner=9 date=1065.5.1 type=dungeon } }",
    ),
  );
  const r = (await run(gs))!;
  expect(r.playerImprisoned).toEqual({ imprisonerName: "Jailer", type: "dungeon", since: "1065.5.1" });
  expect(r.held.some((p) => p.id === 1)).toBe(false);
});

test("returns an empty list when the player holds nobody", async () => {
  const gs = Buffer.from(
    "date=1066.6.1\nplayed_character={ character=1 player=1 }\nliving={ 1={ first_name=\"Ruler\" birth=1020.1.1 skill={ 5 5 5 5 5 5 } } }\n",
  );
  const r = (await run(gs))!;
  expect(r.held).toEqual([]);
  expect(r.kinHeldByOthers).toEqual([]);
  expect(r.worldTotal).toBe(0);
});
