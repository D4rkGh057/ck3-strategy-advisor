import { expect, test } from "vitest";
import {
  riskNotes,
  suggestCouncil,
  type Courtier,
  type CouncilInfo,
} from "../src/extract/council.js";

function c(
  id: number,
  age: number,
  dip: number,
  mar: number,
  ste: number,
  int: number,
  lea: number,
  extra: Partial<Courtier> = {},
): Courtier {
  return {
    id,
    name: `c${id}`,
    age,
    skills: {
      diplomacy: dip,
      martial: mar,
      stewardship: ste,
      intrigue: int,
      learning: lea,
      prowess: 0,
    },
    traits: [],
    traitKeys: [],
    knight: false,
    seat: null,
    vassal: false,
    sameHouse: false,
    health: 4,
    opinion: null,
    claim: null,
    inFaction: false,
    ...extra,
  };
}

const seats = { chancellor: 2, steward: 1, marshal: 3, spymaster: 4, court_chaplain: 5 };

test("suggests the best one-person-per-seat assignment and skips minors", () => {
  const courtiers = [
    c(1, 30, 12, 0, 0, 0, 0),
    c(2, 30, 0, 12, 0, 0, 0),
    c(3, 30, 0, 0, 12, 0, 0),
    c(4, 30, 0, 0, 0, 12, 0),
    c(5, 30, 0, 0, 0, 0, 12),
    c(6, 8, 20, 20, 20, 20, 20),
  ];
  const plan = suggestCouncil({ courtiers, seats });
  const by = Object.fromEntries(plan.map((a) => [a.role, a.suggested?.id]));
  expect(by).toEqual({ chancellor: 1, steward: 3, marshal: 2, spymaster: 4, court_chaplain: 5 });
  expect(plan.find((a) => a.role === "chancellor")!.gain).toBe(12);
});

test("an old, frail pick loses to a slightly weaker healthy one", () => {
  const courtiers = [
    c(1, 77, 0, 0, 0, 14, 0, { health: 2.5 }),
    c(2, 30, 0, 0, 0, 11, 0),
    ...[2, 3, 1, 5].map((id) => c(100 + id, 30, 0, 0, 0, 0, 0)),
  ];
  const plan = suggestCouncil({ courtiers, seats: { ...seats, spymaster: null } });
  expect(plan.find((a) => a.role === "spymaster")!.suggested!.id).toBe(2);
});

test("pressed claimants on your titles and faction members are never suggested", () => {
  const courtiers = [
    c(1, 30, 0, 0, 0, 15, 0, { claim: "pressed" }),
    c(2, 30, 0, 0, 0, 14, 0, { inFaction: true }),
    c(3, 30, 0, 0, 0, 5, 0),
  ];
  const info: CouncilInfo = { courtiers, seats: { ...seats, spymaster: null } };
  expect(suggestCouncil(info).find((a) => a.role === "spymaster")!.suggested!.id).toBe(3);
  expect(riskNotes(courtiers[0]!)).toContain("has a pressed claim on your titles");
});

test("an unpressed family claim only costs a point, it does not disqualify", () => {
  const info: CouncilInfo = {
    courtiers: [c(1, 30, 0, 0, 0, 12, 0, { claim: "unpressed" }), c(2, 30, 0, 0, 0, 5, 0)],
    seats: { ...seats, spymaster: null },
  };
  expect(suggestCouncil(info).find((a) => a.role === "spymaster")!.suggested!.id).toBe(1);
});

test("the player's spouse is not suggested for another seat", () => {
  const info: CouncilInfo = {
    courtiers: [c(1, 30, 0, 0, 12, 0, 0, { spouse: true }), c(2, 30, 0, 0, 9, 0, 0)],
    seats: { ...seats, steward: null },
  };
  expect(suggestCouncil(info).find((a) => a.role === "steward")!.suggested!.id).toBe(2);
});

// suggestCouncil searches only each seat's top candidates; it must still find the same optimum
// as trying everyone, including when one strong person leads several seats.
import {
  suggestCouncil as suggest,
  riskPenalty as penalty,
  ROLE_SKILL as SEAT_SKILL,
  type Courtier as CourtierT,
  type CouncilRole as Role,
} from "../src/extract/council.js";

test("suggestCouncil matches an exhaustive search over the whole pool", () => {
  let seed = 12345;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const roles = Object.keys(SEAT_SKILL) as Role[];
  for (let round = 0; round < 25; round++) {
    const courtiers: CourtierT[] = Array.from({ length: 14 }, (_, i) => ({
      id: i + 1,
      name: `C${i + 1}`,
      age: 20 + rnd(60),
      skills: {
        diplomacy: rnd(25),
        martial: rnd(25),
        stewardship: rnd(25),
        intrigue: rnd(25),
        learning: rnd(25),
        prowess: rnd(25),
      },
      traits: [],
      traitKeys: rnd(5) === 0 ? ["ill"] : [],
      knight: false,
      seat: null,
      vassal: false,
      sameHouse: false,
      health: null,
      opinion: rnd(3) === 0 ? -rnd(40) : null,
      claim: rnd(8) === 0 ? "unpressed" : null,
      inFaction: false,
    }));
    const seats = Object.fromEntries(roles.map((r) => [r, null])) as Record<Role, number | null>;
    const plan = suggest({ courtiers, seats });
    const value = (picks: (CourtierT | null)[]) =>
      picks.reduce(
        (sum, p, i) => sum + (p ? Math.max(p.skills[SEAT_SKILL[roles[i]!]] - penalty(p), 0) : 0),
        0,
      );

    // reference: try every injective assignment (null allowed), no pruning
    const pool = courtiers.filter((x) => (x.age ?? 99) >= 16 && penalty(x) < 100);
    let bestRef = 0;
    const used = new Set<number>();
    const picks: (CourtierT | null)[] = roles.map(() => null);
    const go = (i: number) => {
      if (i === roles.length) {
        bestRef = Math.max(bestRef, value(picks));
        return;
      }
      for (const x of pool) {
        if (used.has(x.id)) continue;
        used.add(x.id);
        picks[i] = x;
        go(i + 1);
        used.delete(x.id);
      }
      picks[i] = null;
      go(i + 1);
    };
    go(0);

    expect(value(plan.map((a) => a.suggested))).toBeCloseTo(bestRef, 5);
    const ids = plan.map((a) => a.suggested?.id).filter((x) => x !== undefined);
    expect(new Set(ids).size).toBe(ids.length); // nobody holds two seats
  }
});
