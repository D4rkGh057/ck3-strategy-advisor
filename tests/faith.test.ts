import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameLookup } from "../src/gameLookup.js";
import { Localizer } from "../src/localization.js";
import { queryGamestate } from "../src/parser.js";
import { extractFaith } from "../src/extract/faith.js";

// Rite 1 (the player's) belongs to faith 13 and differs from it: it adds one doctrine and drops
// another. Rite 2 has a single doctrine, which jomini returns as a bare string, not an array.
const GS = Buffer.from(`date=1066.9.15
played_character={ character=10 player=1 }
faiths={
	database={
		13={
			name="Catholicism"
			doctrine=doctrine_monogamy
			doctrine=doctrine_kinslaying_close_kin_crime
		}
		14={
			name="Solo"
			doctrine=doctrine_monogamy
		}
	}
}
rites={
	database={
		1={
			faith=13
			data={
				name="Insularism"
				tenet=tenet_confession
				tenet=tenet_communal_identity
				doctrine=doctrine_monogamy
				doctrine=doctrine_gender_male_dominated
			}
		}
		2={
			faith=14
			data={
				name="Lone"
				tenet=tenet_confession
				doctrine=doctrine_monogamy
			}
		}
	}
}
living={
10={ first_name="Ruler" birth=1020.1.1 rite=1 }
11={ first_name="Other" birth=1020.1.1 rite=2 }
}
`);

const loc = new Localizer(null);

test("reads the rite's tenets and doctrines and diffs them against the base faith", async () => {
  const f = await queryGamestate(GS, (q) => extractFaith(q, loc));
  expect(f.riteName).toBe("Insularism");
  expect(f.faithName).toBe("Catholicism");
  expect(f.tenets).toEqual(["Confession", "Communal identity"]);
  expect(f.doctrines).toEqual(["Monogamy", "Gender male dominated"]);
  expect(f.addedDoctrines).toEqual(["Gender male dominated"]);
  expect(f.removedDoctrines).toEqual(["Kinslaying close kin crime"]);
});

test("a single repeated key (bare string in jomini) still yields a list", async () => {
  const gs = Buffer.from(GS.toString().replace("character=10 player=1", "character=11 player=1"));
  const f = await queryGamestate(gs, (q) => extractFaith(q, loc));
  expect(f.riteName).toBe("Lone");
  expect(f.tenets).toEqual(["Confession"]);
  expect(f.doctrines).toEqual(["Monogamy"]);
  expect(f.addedDoctrines).toEqual([]);
  expect(f.removedDoctrines).toEqual([]);
});

test("a character without a rite yields an empty result instead of throwing", async () => {
  const gs = Buffer.from(GS.toString().replace("first_name=\"Ruler\" birth=1020.1.1 rite=1", "first_name=\"Ruler\" birth=1020.1.1"));
  const f = await queryGamestate(gs, (q) => extractFaith(q, loc));
  expect(f.riteName).toBeNull();
  expect(f.tenets).toEqual([]);
  expect(f.doctrines).toEqual([]);
});

function gameFiles() {
  const root = mkdtempSync(join(tmpdir(), "ck3-faith-"));
  mkdirSync(join(root, "common", "religion", "doctrine_types"), { recursive: true });
  mkdirSync(join(root, "localization", "english"), { recursive: true });
  writeFileSync(
    join(root, "common", "religion", "doctrine_types", "20_doctrines.txt"),
    [
      "doctrine_monogamy = {\n\tdoctrine_group_type = doctrine_marriage_type\n\tindex = 0\n}",
      "doctrine_gender_male_dominated = {\n\tdoctrine_group_type = doctrine_gender\n}",
      "doctrine_kinslaying_close_kin_crime = {\n\tdoctrine_group_type = doctrine_kinslaying\n}",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "localization", "english", "religion_l_english.yml"),
    "﻿l_english:\n" +
      ' doctrine_marriage_type_name: "Marriage"\n' +
      ' doctrine_monogamy_name: "Monogamous"\n' +
      ' doctrine_gender_name: "Gender"\n' +
      ' doctrine_gender_male_dominated_name: "Male Dominated"\n' +
      // Group has no localized name: the value must be shown alone, not a guessed group.
      ' doctrine_kinslaying_close_kin_crime_name: "Close Kin is Criminal"\n',
  );
  const loc = new Localizer(root);
  return { loc, lookup: new GameLookup(root, loc) };
}

test("with game files, each doctrine is prefixed by its group so bare values are not ambiguous", async () => {
  const { loc, lookup } = gameFiles();
  const f = await queryGamestate(GS, (q) => extractFaith(q, loc, lookup));
  expect(f.doctrines).toEqual(["Marriage: Monogamous", "Gender: Male Dominated"]);
  expect(f.addedDoctrines).toEqual(["Gender: Male Dominated"]);
  // The group has no localization, so the value stands alone instead of an invented group.
  expect(f.removedDoctrines).toEqual(["Close Kin is Criminal"]);
});

test("a doctrine absent from the game files keeps its plain value", async () => {
  const { loc } = gameFiles();
  const empty = new GameLookup(null, loc);
  const f = await queryGamestate(GS, (q) => extractFaith(q, loc, empty));
  expect(f.doctrines).toEqual(["Monogamous", "Male Dominated"]);
});
