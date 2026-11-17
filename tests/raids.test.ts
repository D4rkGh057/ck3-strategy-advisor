import { expect, test } from "vitest";
import { queryGamestate } from "../src/parser.js";
import { extractRaids } from "../src/extract/raids.js";

// Player 1. Army 10: player's active raid (raid=70). Army 11: player's raid-capable army with no
// raid running. Army 12: foreign active raid (owner 9). Army 13: player's army that cannot raid.
// Army 14: foreign raid-capable but idle (must not be listed). Raid 72 is `none`.
const GS = Buffer.from(`
date=868.12.20
played_character={ character=1 player=1 }
living={
1={ first_name="Ulfrik" }
2={ first_name="Bjorn" }
9={ first_name="Harald" }
}
armies={
  regiments={ }
  army_regiments={
    100={ type=vigmen cached={ current=100 max=100 } army=10 }
    101={ type=vigmen cached={ current=50 max=60 } army=10 }
    102={ type=vigmen cached={ current=30 max=30 } army=12 }
    103={ type=vigmen cached={ current=20 max=20 } army=11 }
  }
  armies={
    10={ regiments={ 100 101 } commander=2 unit=50 raid=70 supply=93 gathered_date=868.1.29
         raid_army=yes raid_gold=38.4 looter=yes raid_intent={ type=pillage_intent_tribal } }
    11={ regiments={ 103 } unit=51 supply=100 raid_army=yes raid_intent={ } }
    12={ regiments={ 102 } commander=9 unit=52 raid=71 supply=80 raid_army=yes
         raid_intent={ type=capture_intent_norse } }
    13={ regiments={ 103 } unit=53 supply=100 }
    14={ regiments={ 103 } unit=54 supply=100 raid_army=yes raid_intent={ } }
  }
}
units={
  50={ type=army location=3 owner=1 army=10 }
  51={ type=army location=4 owner=1 army=11 }
  52={ type=army location=5 owner=9 army=12 }
  53={ type=army location=6 owner=1 army=13 }
  54={ type=army location=7 owner=9 army=14 }
}
raid={ raid={
  70={ progress=824.38 army=10 province=3 }
  71={ progress=10 army=12 province=5 }
  72=none
} }
`);

const run = (gs = GS) => queryGamestate(gs, (q) => extractRaids(q))!;

test("lists the player's raid-capable armies, active raid first", async () => {
  const r = await run();
  expect(r.mine.map((a) => a.armyId)).toEqual([10, 11]);
  expect(r.mine.map((a) => a.active)).toEqual([true, false]);
});

test("reads loot, progress, province, intent, supply and commander of an active raid", async () => {
  const a = (await run()).mine[0]!;
  expect(a.loot).toBe(38.4);
  expect(a.progress).toBe(824.38);
  expect(a.province).toBe(3);
  expect(a.intent).toBe("pillage_intent_tribal");
  expect(a.supply).toBe(93);
  expect(a.commanderName).toBe("Bjorn");
  expect(a.raised).toBe("868.1.29");
});

test("sums current and max men over the army's regiments", async () => {
  const a = (await run()).mine[0]!;
  expect(a.men).toBe(150);
  expect(a.maxMen).toBe(160);
});

test("an idle raid-capable army has no raid data and no intent", async () => {
  const a = (await run()).mine[1]!;
  expect(a.progress).toBeNull();
  expect(a.loot).toBeNull();
  expect(a.intent).toBeNull();
  expect(a.province).toBe(4);
});

test("other rulers' raids list only active ones, with the owner's name", async () => {
  const r = await run();
  expect(r.others.map((a) => a.armyId)).toEqual([12]);
  expect(r.others[0]!.ownerName).toBe("Harald");
  expect(r.others[0]!.intent).toBe("capture_intent_norse");
  expect(r.worldActive).toBe(2);
});

test("a save with no raid section returns empty lists instead of throwing", async () => {
  const bare = Buffer.from(`date=1066.1.1\nplayed_character={ character=1 }\nliving={ 1={ first_name="A" } }\n`);
  const r = await run(bare);
  expect(r).toEqual({ mine: [], others: [], worldActive: 0 });
});
