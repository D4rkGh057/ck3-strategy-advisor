import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import {
  caravanMasterAptitude,
  educatorScore,
  extractGuardians,
  roleReasons,
  tutorAptitude,
  wetNurseAptitude,
  type Person,
} from "../src/extract/guardians.js";

// traits_lookup: 0 erudite, 1 patient, 2 devoted, 3 strong, 4 charming, 5 rowdy, 6 intellect_good_2
const GS = Buffer.from(`
traits_lookup={ "erudite" "patient" "devoted" "strong" "charming" "rowdy" "intellect_good_2" }
date=1066.6.1
played_character={ character=1 player=1 }
court_positions={ database={
  1={ court_position="court_tutor_court_position" employee=5 employer=1 }
  2={ court_position="seneschal_court_position" employee=7 employer=1 }
  3={ court_position="champion_court_position" employee=10 employer=1 }
} }
opinions={ active_opinions={
  { owner=20 target=6 scripted_relations={ guardian={ flags="AA==" } } }
  { owner=6 target=20 scripted_relations={ ward={ flags="AA==" } } }
  { owner=21 target=6 scripted_relations={ guardian={ flags="AA==" } } }
  { owner=22 target=8 scripted_relations={ wet_nurse={ flags="AA==" } } }
} }
living={
1={ first_name="Ruler" birth=1020.1.1 dynasty_house=1 skill={ 5 5 5 5 5 5 } landed_data={ domain={ 11 } } family_data={ spouse=2 child={ 3 } }
    alive_data={ health=6 } }
2={ first_name="Wife" birth=1025.1.1 female=yes dynasty_house=1 skill={ 5 5 5 5 12 5 } court_data={ employer=1 } family_data={ spouse=1 } alive_data={ health=6 } }
3={ first_name="Daughter" birth=1045.1.1 female=yes dynasty_house=1 skill={ 5 5 5 5 5 5 } court_data={ employer=1 } alive_data={ health=6 } }
5={ first_name="Tutor" birth=1030.1.1 dynasty_house=2 skill={ 5 5 5 5 14 5 } traits={ 0 1 } court_data={ employer=1 } alive_data={ health=5 } }
6={ first_name="Guardian" birth=1030.1.1 dynasty_house=2 skill={ 9 5 5 5 8 5 } court_data={ employer=1 } alive_data={ health=5 } }
7={ first_name="Seneschal" birth=1030.1.1 female=yes skill={ 5 5 18 5 5 5 } court_data={ employer=1 } alive_data={ health=5 } }
8={ first_name="Nurse" birth=1035.1.1 female=yes skill={ 5 5 5 5 5 5 } traits={ 3 } court_data={ employer=1 } family_data={ child={ 30 } } alive_data={ health=6 } }
9={ first_name="Nun" birth=1035.1.1 female=yes skill={ 5 5 5 5 5 5 } traits={ 2 } court_data={ employer=1 } alive_data={ health=6 } }
10={ first_name="Champ" birth=1030.1.1 skill={ 5 5 5 5 3 5 } court_data={ employer=1 } alive_data={ health=5 } }
20={ first_name="Kid" birth=1058.1.1 skill={ 5 5 5 5 5 5 } traits={ 5 6 } court_data={ employer=1 } alive_data={ focus={ type=education_learning } } }
21={ first_name="Kid2" birth=1060.1.1 female=yes skill={ 5 5 5 5 5 5 } traits={ 4 } court_data={ employer=1 } alive_data={ focus={ type=education_diplomacy } } }
22={ first_name="Baby" birth=1066.1.1 skill={ 5 5 5 5 5 5 } court_data={ employer=1 } }
}
`);

const run = () => queryGamestate(GS, (q) => extractGuardians(q, new Localizer(null), null, 3));

test("lists only children at court, with focus and current guardian from the opinions table", async () => {
  const r = (await run())!;
  expect(r.children.map((c) => c.name)).toEqual(["Baby", "Kid2", "Kid"]);
  const kid = r.children.find((c) => c.name === "Kid")!;
  expect(kid.focus).toBe("learning");
  expect(kid.guardian?.name).toBe("Guardian");
  expect(r.children.find((c) => c.name === "Baby")!.focus).toBeNull();
  expect(r.children.find((c) => c.name === "Baby")!.wetNurse?.name).toBe("Nurse");
});

test("ranks guardians by the focus skill and drops adults who already have two wards", async () => {
  const r = (await run())!;
  const kid = r.children.find((c) => c.name === "Kid")!;
  // Guardian (learning 8) has 2 wards but keeps Kid, so it stays; Wife (12) and Tutor (14) lead.
  expect(kid.picks.map((p) => p.person.name)).toEqual(["Tutor", "Wife", "Guardian"]);
  const kid2 = r.children.find((c) => c.name === "Kid2")!;
  // Guardian (diplomacy 9) already has 2 wards, but Kid2 is one of them, so they stay eligible.
  expect(kid2.picks[0]!.person.name).toBe("Guardian");
  const baby = r.children.find((c) => c.name === "Baby")!;
  expect(baby.picks).toEqual([]);
});

test("always lists the current guardian, even below the top picks", async () => {
  const r = (await queryGamestate(GS, (q) => extractGuardians(q, new Localizer(null), null, 1)))!;
  const kid = r.children.find((c) => c.name === "Kid")!;
  expect(kid.picks.map((p) => p.person.name)).toEqual(["Tutor", "Guardian"]);
});

test("applies the validity rules per court position", async () => {
  const r = (await run())!;
  const tutor = r.roles.find((x) => x.role === "tutor")!;
  expect(tutor.current?.person.name).toBe("Tutor");
  expect(tutor.ranked.map((c) => c.person.name)).not.toContain("Wife"); // the ruler's spouse
  expect(tutor.ranked.map((c) => c.person.name)).not.toContain("Seneschal"); // full-time job
  expect(tutor.excluded.find((e) => e.person.name === "Seneschal")!.reasons.join()).toContain(
    "already holds seneschal",
  );
  const nurse = r.roles.find((x) => x.role === "wet_nurse")!;
  expect(nurse.ranked.map((c) => c.person.name)).toContain("Nurse");
  expect(nurse.ranked.map((c) => c.person.name)).not.toContain("Nun"); // devoted
  expect(nurse.ranked.map((c) => c.person.name)).not.toContain("Daughter"); // close family + not an adult
  expect(nurse.ranked.map((c) => c.person.name)).not.toContain("Tutor"); // male
});

test("childhood traits match or clash with the education focus", async () => {
  const r = (await run())!;
  const kid = r.children.find((c) => c.name === "Kid")!; // rowdy, focus learning
  expect(kid.childhood).toEqual(["rowdy"]);
  expect(kid.fit).toBe("bad");
  expect(kid.affinity).toEqual(["martial", "intrigue"]);
  expect(kid.intelligence).toBe(15);
  const kid2 = r.children.find((c) => c.name === "Kid2")!; // charming, focus diplomacy
  expect(kid2.fit).toBe("good");
  expect(kid2.affinity).toEqual(["diplomacy", "intrigue"]);
  expect(kid2.disaffinity).toEqual(["stewardship"]);
  expect(r.children.find((c) => c.name === "Baby")!.fit).toBeNull();
});

test("educator score is 0.4 x focus skill + 0.2 x Learning + intelligence", () => {
  const p = person({
    skills: { diplomacy: 10, martial: 5, stewardship: 5, intrigue: 5, learning: 20, prowess: 5 },
    traits: ["intellect_good_2"],
  });
  expect(educatorScore(p, "diplomacy")).toBeCloseTo(4 + 4 + 10);
});

const person = (over: Partial<Person> = {}): Person => ({
  id: 9,
  name: "P",
  age: 30,
  female: false,
  skills: { diplomacy: 5, martial: 5, stewardship: 5, intrigue: 5, learning: 5, prowess: 5 },
  traits: [],
  landed: false,
  lowborn: true,
  hasChildren: false,
  health: 5,
  languages: 1,
  imprisoned: false,
  relation: "relative",
  holds: null,
  wards: 0,
  ...over,
});
const ruler = person({ id: 1, relation: "self" });

test("landed tutors need Learning 12", () => {
  const low = person({ landed: true });
  expect(roleReasons("tutor", low, ruler).join()).toContain("needs 12");
  const ok = person({ landed: true, skills: { ...low.skills, learning: 12 } });
  expect(roleReasons("tutor", ok, ruler)).toEqual([]);
});

test("wet nurse must be a young, female, non-devoted, non-landed non-relative", () => {
  const base = person({ female: true });
  expect(roleReasons("wet_nurse", base, ruler)).toEqual([]);
  expect(roleReasons("wet_nurse", person({ female: false }), ruler)).toContain("not female");
  expect(roleReasons("wet_nurse", person({ female: true, age: 46 }), ruler)).toContain(
    "age 46 or older",
  );
  expect(roleReasons("wet_nurse", person({ female: true, relation: "sibling" }), ruler)).toContain(
    "close family of the ruler",
  );
  expect(roleReasons("wet_nurse", person({ female: true, traits: ["devoted"] }), ruler)).toContain(
    "devoted",
  );
  expect(roleReasons("wet_nurse", person({ female: true, relation: "spouse" }), ruler)).toContain(
    "spouse of the ruler",
  );
});

test("holding a position that is not a full-time job does not rule anyone out", async () => {
  const r = (await run())!;
  const tutor = r.roles.find((x) => x.role === "tutor")!;
  const champ = tutor.ranked.find((c) => c.person.name === "Champ");
  expect(champ?.person.holds).toBe("champion_court_position");
  expect(roleReasons("tutor", person({ holds: "court_physician_court_position" }), ruler)).toEqual(
    [],
  );
});

test("a different full-time job rules a candidate out, their own position does not", () => {
  const p = person({ holds: "wet_nurse_court_position", female: true });
  expect(roleReasons("wet_nurse", p, ruler)).toEqual([]);
  expect(roleReasons("caravan_master", p, ruler).join()).toContain("already holds wet_nurse");
});

test("aptitude follows the game scripts", () => {
  const learner = person({
    skills: { diplomacy: 5, martial: 5, stewardship: 10, intrigue: 5, learning: 14, prowess: 5 },
    traits: ["erudite", "patient"],
  });
  expect(tutorAptitude(learner)).toBe(25 + 35 + 15 + 15);
  // health >= 5 -> health*5 + 10; < 3 -> health*10 - 30; otherwise health*2; +15 with children
  expect(wetNurseAptitude(person({ health: 6 }))).toBe(25 + 40);
  expect(wetNurseAptitude(person({ health: 2 }))).toBe(25 - 10);
  expect(wetNurseAptitude(person({ health: 4, hasChildren: true }))).toBe(25 + 8 + 15);
  // 1 + learning + 1.3 x stewardship + (languages - 1) x 5
  expect(
    caravanMasterAptitude(
      person({
        languages: 3,
        skills: { diplomacy: 5, martial: 5, stewardship: 10, intrigue: 5, learning: 6, prowess: 5 },
      }),
    ),
  ).toBeCloseTo(1 + 6 + 13 + 10);
});
