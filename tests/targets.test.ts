import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { Localizer } from "../src/localization.js";
import { extractTargets } from "../src/extract/targets.js";

const GS = Buffer.from(`
played_character={ character=1 player=1 }
landed_titles={
landed_titles={
10={ key="k_ireland" name="Ireland" de_jure_vassals={ 11 14 } }
11={ key="d_munster" name="Munster" holder=1 de_jure_liege=10 de_jure_vassals={ 12 13 17 } }
12={ key="c_desmond" name="Desmond" holder=2 de_jure_liege=11 de_jure_vassals={ 20 21 } }
13={ key="c_limerick" name="Limerick" holder=1 de_jure_liege=11 }
14={ key="d_leinster" name="Leinster" de_jure_liege=10 de_jure_vassals={ 15 16 } }
15={ key="c_ossory" name="Ossory" holder=3 de_jure_liege=14 de_facto_liege=18 }
16={ key="c_dublin" name="Dublin" holder=5 de_jure_liege=14 }
17={ key="c_ormond" name="Ormond" holder=6 de_jure_liege=11 de_facto_liege=11 }
18={ key="k_osraige" name="Osraige" holder=4 }
}
}
living={
1={ first_name="Murchad" alive_data={ claim={ { title=15 } } } landed_data={ domain={ 11 13 } strength=800 } }
2={ first_name="Muiredach" alive_data={ gold={ value=70 } } landed_data={ domain={ 12 } strength=500 } }
3={ first_name="Domnall" landed_data={ domain={ 15 } strength=300 } }
4={ first_name="Cerball" landed_data={ domain={ 18 } strength=200 } }
5={ first_name="Sitric" landed_data={ domain={ 16 } strength=400 } }
6={ first_name="Rognvaldr" landed_data={ domain={ 17 } strength=100 } }
}
`);

test("ranks de jure, then claim, then fabricate, skips your own and your vassals' counties", async () => {
  const r = await queryGamestate(GS, (q) => extractTargets(q, new Localizer(null), 800));
  expect(r!.region).toBe("Ireland");
  expect(r!.targets.map((t) => [t.county, t.route])).toEqual([
    ["Desmond", "de_jure"],
    ["Ossory", "claim"],
    ["Dublin", "fabricate"],
  ]);
  const ossory = r!.targets[1]!;
  expect(ossory.liege?.name).toBe("Cerball");
  expect(ossory.defenderStrength).toBe(500); // holder 300 + liege 200
  expect(ossory.odds).toBeCloseTo(1.6);
  expect(r!.targets[0]!.holderGold).toBe(70);
});

const GS_REALM = Buffer.from(`
played_character={ character=1 player=1 }
landed_titles={
landed_titles={
10={ key="k_ireland" name="Ireland" holder=1 de_jure_vassals={ 11 14 } }
11={ key="d_munster" name="Munster" holder=1 de_jure_liege=10 de_facto_liege=10 }
14={ key="d_leinster" name="Leinster" holder=7 de_jure_liege=10 de_facto_liege=10 de_jure_vassals={ 31 32 } }
31={ key="c_ossory" name="Ossory" holder=7 de_jure_liege=14 de_facto_liege=14 }
32={ key="c_dublin" name="Dublin" holder=5 de_jure_liege=14 de_facto_liege=33 }
33={ key="d_dyflin" name="Dyflin" holder=5 }
}
}
living={
1={ first_name="Murchad" landed_data={ domain={ 10 11 } strength=800 } }
5={ first_name="Sitric" landed_data={ domain={ 32 33 } strength=400 } }
7={ first_name="Fáelcar" landed_data={ domain={ 14 31 } strength=474 } }
}
`);

test("skips counties held through a vassal's duchy, however deep the chain to you", async () => {
  const r = await queryGamestate(GS_REALM, (q) => extractTargets(q, new Localizer(null), 800));
  // Ossory's liege is Leinster (a vassal's duchy), whose liege is your kingdom.
  expect(r!.targets.map((t) => t.county)).toEqual(["Dublin"]);
});

test("does not count a holder's strength twice when the holder is also the liege", async () => {
  const r = await queryGamestate(GS_REALM, (q) => extractTargets(q, new Localizer(null), 800));
  const dublin = r!.targets[0]!;
  expect(dublin.liege?.id).toBe(5);
  expect(dublin.defenderStrength).toBe(400); // Sitric once, not 400 + 400
  expect(dublin.odds).toBeCloseTo(2);
});
