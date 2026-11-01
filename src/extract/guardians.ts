import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import type { GameLookup, Skill } from "../gameLookup.js";
import { ageAt, idList, num, playerIdOf } from "./common.js";
import { Kin, buildParentIndex, type ParentIndexStore } from "./family.js";
import { fullNameOf } from "./names.js";
import { effectiveSkills, type SkillSet } from "./skills.js";

type Rec = Record<string, unknown>;

export type GuardianRole = "tutor" | "wet_nurse" | "caravan_master";

export const ROLE_POSITION: Record<GuardianRole, string> = {
  tutor: "court_tutor_court_position",
  wet_nurse: "wet_nurse_court_position",
  caravan_master: "travel_leader_court_position",
};

/**
 * `court_position_does_not_already_have_a_job_trigger` (00_court_position_triggers.txt): holding
 * any of these counts as a full-time job, so a second one from the list is refused. The position
 * being filled is exempt for its own holder (the tutor check also exempts `court_guru`).
 */
export const FULL_TIME_POSITIONS = new Set([
  "court_tutor_court_position",
  "court_guru_court_position",
  "food_taster_court_position",
  "seneschal_court_position",
  "cupbearer_court_position",
  "antiquarian_court_position",
  "lady_in_waiting_court_position",
  "court_jester_court_position",
  "court_poet_court_position",
  "court_musician_court_position",
  "bodyguard_court_position",
  "executioner_court_position",
  "court_gardener_court_position",
  "travel_leader_court_position",
  "wet_nurse_court_position",
  "akolouthos_court_position",
  "grand_preceptor_court_position",
  "grand_guardian_court_position",
  "grand_mentor_court_position",
  "fire_dragon_engineer_court_position",
  "keeper_of_the_harem_court_position",
  "court_artificer_court_position",
  "cave_hermit_court_position",
  "master_assassin_court_position",
  "court_scholar_court_position",
  "charioteer_court_position",
  "bookmaker_court_position",
  "court_brewmaster_court_position",
  "khlon_glan_court_position",
  "eparch_court_position",
]);

const ADULT_AGE = 16;
const HIGH_SKILL = 15; // script value `high_skill_rating`
const MAX_WARDS = 2; // educate_child_interaction: `num_of_relation_ward < 2`

export interface Person {
  id: number;
  name: string;
  age: number;
  female: boolean;
  skills: SkillSet;
  traits: string[];
  landed: boolean;
  /** No `dynasty_house` in the save: the game treats them as lowborn, i.e. a commoner. */
  lowborn: boolean;
  hasChildren: boolean;
  health: number;
  languages: number;
  imprisoned: boolean;
  /** Kinship to the player ("self", "spouse", "child", "sibling", ...) from the save's family links. */
  relation: string;
  /** Court position (raw key) this person already holds at the player's court, if any. */
  holds: string | null;
  /** Children they are currently guardian of. */
  wards: number;
}

export interface RoleCandidate {
  person: Person;
  aptitude: number;
  /** Things the save cannot settle; the game may still refuse them. */
  caveats: string[];
}

export interface RoleRanking {
  role: GuardianRole;
  position: string;
  current: RoleCandidate | null;
  ranked: RoleCandidate[];
  excluded: { person: Person; reasons: string[] }[];
}

export interface ChildEntry {
  id: number;
  name: string;
  age: number;
  female: boolean;
  relation: string;
  /** Skill the education focus trains; null when the child has no education focus yet. */
  focus: Skill | null;
  skills: SkillSet;
  guardian: { id: number; name: string } | null;
  wetNurse: { id: number; name: string } | null;
  /** Childhood personality traits (charming, curious, rowdy, bossy, pensive). */
  childhood: string[];
  /** How the current focus matches the childhood traits; null without a focus. */
  fit: FocusFit | null;
  /** Foci whose affinity trait the child has. */
  affinity: Skill[];
  /** Foci whose disaffinity trait the child has. */
  disaffinity: Skill[];
  /** Success-weight bonus from the child's own intelligence trait (20/15/10), 0 if none. */
  intelligence: number;
}

export interface GuardianPick {
  person: Person;
  /** Educator score: 0.4 x focus skill + 0.2 x Learning + intelligence bonus. */
  value: number;
  skill: number;
}

export type FocusFit = "good" | "bad" | "neutral";

export interface GuardiansInfo {
  children: (ChildEntry & { picks: GuardianPick[] })[];
  roles: RoleRanking[];
}

type EducationSkill = "diplomacy" | "martial" | "stewardship" | "intrigue" | "learning";

/** 00_education_triggers.txt: childhood traits that help (+20) or hurt (-20) an education focus. */
export const AFFINITY: Record<EducationSkill, string[]> = {
  diplomacy: ["charming", "curious"],
  martial: ["rowdy", "bossy"],
  stewardship: ["bossy", "pensive"],
  intrigue: ["charming", "rowdy"],
  learning: ["pensive", "curious"],
};
export const DISAFFINITY: Record<EducationSkill, string> = {
  diplomacy: "bossy",
  martial: "curious",
  stewardship: "charming",
  intrigue: "pensive",
  learning: "rowdy",
};
export const CHILDHOOD_TRAITS = ["charming", "curious", "rowdy", "bossy", "pensive"];
const FOCI = Object.keys(AFFINITY) as EducationSkill[];

/** 00_education_effects.txt: the child's own intelligence adds to the chance of a good outcome. */
export function childIntelligence(traits: string[]): number {
  if (traits.includes("intellect_good_3")) return 20;
  if (traits.includes("intellect_good_2")) return 15;
  if (traits.includes("intellect_good_1") || traits.includes("shrewd")) return 10;
  return 0;
}

/**
 * What an educator adds to the success weight of an education roll: 0.4 x the focus skill,
 * 0.2 x Learning and a bonus for intelligence (00_education_effects.txt, 00_education_values.txt).
 */
export function educatorScore(p: Person, focus: EducationSkill): number {
  let intel = 0;
  if (p.traits.includes("intellect_good_3")) intel = 15;
  else if (p.traits.includes("intellect_good_2")) intel = 10;
  else if (p.traits.includes("intellect_good_1") || p.traits.includes("shrewd")) intel = 5;
  return p.skills[focus] * 0.4 + p.skills.learning * 0.2 + intel;
}

const has = (p: Person, ...keys: string[]) => keys.some((k) => p.traits.includes(k));

/** `aptitude` of `court_tutor_court_position`; the landed penalty is `court_position_aptitude_low_penalty_value`. */
export function tutorAptitude(p: Person): number {
  const s = p.skills;
  let v = 25 + Math.min(s.learning * 2.5, 50);
  if (
    s.diplomacy >= HIGH_SKILL &&
    s.martial >= HIGH_SKILL &&
    s.stewardship >= HIGH_SKILL &&
    s.intrigue >= HIGH_SKILL &&
    s.learning >= HIGH_SKILL
  )
    v += 20;
  if (has(p, "erudite")) v += 15;
  if (has(p, "patient")) v += 15;
  if (has(p, "calm")) v += 15;
  if (has(p, "shy")) v -= 10;
  if (has(p, "intellect_good_3")) v += 40;
  else if (has(p, "intellect_good_2")) v += 20;
  else if (has(p, "intellect_good_1", "shrewd")) v += 10;
  if (has(p, "reclusive")) v -= 10;
  if (p.landed) v -= 20;
  if (has(p, "maimed")) v -= 15;
  if (has(p, "infirm")) v -= 75;
  return v;
}

/** `aptitude` of `wet_nurse_court_position`; penalties are `court_position_aptitude_high_penalty_value`. */
export function wetNurseAptitude(p: Person): number {
  let v = 25;
  if (p.health >= 5) v += p.health * 5 + 10;
  else if (p.health < 3) v += p.health * 10 - 30;
  else v += p.health * 2;
  if (p.hasChildren) v += 15;
  if (has(p, "strong")) v += 15;
  if (has(p, "physique_good_3")) v += 20;
  if (has(p, "physique_good_2")) v += 15;
  if (has(p, "physique_good_1")) v += 10;
  if (has(p, "loyal")) v += 10;
  if (p.landed) v -= 20;
  if (has(p, "maimed")) v -= 25;
  if (has(p, "blind")) v -= 50;
  if (has(p, "infirm")) v -= 75;
  return v;
}

const TRAVEL_BONUS: Record<string, number> = {
  adventurer: 10,
  brave: 5,
  lifestyle_herbalist: 5,
  lifestyle_hunter: 5,
  diligent: 5,
  flexible_leader: 10,
  forest_fighter: 10,
  open_terrain_expert: 10,
  rough_terrain_expert: 10,
  desert_warrior: 10,
  jungle_stalker: 10,
  winter_soldier: 10,
  administrator: 5,
  erudite: 5,
  lifestyle_physician: 5,
  craven: -20,
  lazy: -10,
  clubfooted: -30,
  blind: -50,
  infirm: -50,
  maimed: -30,
  lifestyle_reveler: -5,
};

/**
 * `aptitude` of `travel_leader_court_position`, WITHOUT its speed and safety terms (they come from
 * the caravan's current state, which the save does not store) and without the lifestyle_traveler
 * XP tiers and perks. Treat it as a lower bound that is good for comparing candidates.
 */
export function caravanMasterAptitude(p: Person): number {
  const s = p.skills;
  let v = 1 + Math.min(s.learning, 50) + Math.min(s.stewardship * 1.3, 50);
  if (p.languages >= 2) v += Math.min((p.languages - 1) * 5, 50);
  for (const t of p.traits) v += TRAVEL_BONUS[t] ?? 0;
  if (has(p, "lifestyle_traveler")) v += 20; // base tier; the 30/40 tiers need trait XP
  if (has(p, "incapable")) return 0;
  if (p.landed) v -= 20;
  if (has(p, "maimed")) v -= 25;
  if (has(p, "blind")) v -= 50;
  if (has(p, "infirm")) v -= 75;
  return Math.max(v, 0);
}

function jobReason(p: Person, own: string): string | null {
  // Only the positions in FULL_TIME_POSITIONS count as a job (a champion or physician is free).
  if (p.holds === null || p.holds === own || !FULL_TIME_POSITIONS.has(p.holds)) return null;
  if (own === ROLE_POSITION.tutor && p.holds === "court_guru_court_position") return null;
  return `already holds ${p.holds.replace(/_court_position$/, "")}`;
}

function isCloseFamily(relation: string): boolean {
  return (
    relation === "child" ||
    relation === "parent" ||
    relation === "sibling" ||
    relation === "half-sibling"
  );
}

/** Why `p` cannot take `role`, from the validity triggers in 00_court_position_triggers.txt. */
export function roleReasons(role: GuardianRole, p: Person, ruler: Person): string[] {
  const out: string[] = [];
  if (p.age < ADULT_AGE) out.push("not an adult");
  if (p.imprisoned) out.push("imprisoned");
  if (p.id === ruler.id) out.push("is the ruler");
  if (p.relation === "spouse") out.push("spouse of the ruler");
  const job = jobReason(p, ROLE_POSITION[role]);
  if (job) out.push(job);
  if (role === "tutor" && p.landed && p.skills.learning < 12)
    out.push(`landed with Learning ${p.skills.learning} (needs 12)`);
  if (role === "wet_nurse") {
    if (p.landed) out.push("landed (must not be a ruler)");
    if (!p.female) out.push("not female");
    if (p.age >= 46) out.push("age 46 or older");
    if (isCloseFamily(p.relation)) out.push("close family of the ruler");
    if (has(p, "devoted")) out.push("devoted");
  }
  if (role === "caravan_master" && p.landed) out.push("landed");
  return out;
}

function caveatsFor(role: GuardianRole, p: Person): string[] {
  const out: string[] = [];
  if (role === "wet_nurse" && !p.lowborn) out.push("commoner status not checked (has a dynasty)");
  if (role === "caravan_master") out.push("clergy status not checked");
  return out;
}

const APTITUDE: Record<GuardianRole, (p: Person) => number> = {
  tutor: tutorAptitude,
  wet_nurse: wetNurseAptitude,
  caravan_master: caravanMasterAptitude,
};

export function rankRole(role: GuardianRole, people: Person[], ruler: Person): RoleRanking {
  const position = ROLE_POSITION[role];
  const ranked: RoleCandidate[] = [];
  const excluded: { person: Person; reasons: string[] }[] = [];
  let current: RoleCandidate | null = null;
  for (const p of people) {
    const candidate = { person: p, aptitude: APTITUDE[role](p), caveats: caveatsFor(role, p) };
    if (p.holds === position) current = candidate;
    const reasons = roleReasons(role, p, ruler);
    if (reasons.length === 0) ranked.push(candidate);
    else if (p.holds !== position) excluded.push({ person: p, reasons });
  }
  ranked.sort((a, b) => b.aptitude - a.aptitude);
  return { role, position, current, ranked, excluded };
}

const FOCUS = /^education_(diplomacy|martial|stewardship|intrigue|learning)$/;

export function extractGuardians(
  q: Query,
  loc: Localizer,
  lookup: GameLookup | null,
  perChild = 3,
  store?: ParentIndexStore,
): GuardiansInfo | null {
  loc.setTraitLookup((q.at("/traits_lookup") as string[] | null | undefined) ?? null);
  const playerId = playerIdOf(q);
  const date = q.at("/date");
  const living = (q.at("/living") as Record<string, unknown> | undefined) ?? {};
  const recOf = (id: number): Rec | null => {
    const raw = living[String(id)];
    const r = Array.isArray(raw) ? raw[0] : raw;
    return r && typeof r === "object" ? (r as Rec) : null;
  };
  if (!recOf(playerId)) return null;

  const kin = new Kin(q, buildParentIndex(q, living, store));

  // Court positions held at this court: employee -> raw position key.
  const holds = new Map<number, string>();
  const db = (q.at("/court_positions/database") as Record<string, unknown> | undefined) ?? {};
  for (const raw of Object.values(db)) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Rec;
    if (
      p["employer"] === playerId &&
      typeof p["employee"] === "number" &&
      typeof p["court_position"] === "string"
    ) {
      // Someone with two positions: keep the full-time one, it is the one that blocks others.
      const prev = holds.get(p["employee"]);
      if (prev === undefined || !FULL_TIME_POSITIONS.has(prev))
        holds.set(p["employee"], p["court_position"]);
    }
  }

  // Adults and children at the player's court (the player counts as an adult guardian).
  const adultIds: number[] = [playerId];
  const childIds: number[] = [];
  for (const [key, raw] of Object.entries(living)) {
    const r = Array.isArray(raw) ? raw[0] : raw;
    if (!r || typeof r !== "object") continue;
    const id = Number(key);
    if (id === playerId) continue;
    if (num(((r as Rec)["court_data"] as Rec | undefined)?.["employer"]) !== playerId) continue;
    const age = ageAt((r as Rec)["birth"], date);
    if (age === null) continue;
    (age < ADULT_AGE ? childIds : adultIds).push(id);
  }
  const childSet = new Set(childIds);

  // Guardian links live in /opinions/active_opinions as scripted relations on the child's
  // entry: { owner=<child> target=<guardian> scripted_relations={ guardian={..} wet_nurse={..} } }.
  const guardianOf = new Map<number, number>();
  const wetNurseOf = new Map<number, number>();
  const wardCount = new Map<number, number>();
  const opinions = (q.at("/opinions/active_opinions") as Rec[] | undefined) ?? [];
  for (const e of opinions) {
    const rel = e["scripted_relations"] as Rec | undefined;
    if (!rel) continue;
    const owner = num(e["owner"]);
    const target = num(e["target"]);
    if (owner === null || target === null) continue;
    if (rel["guardian"] !== undefined) {
      wardCount.set(target, (wardCount.get(target) ?? 0) + 1);
      if (childSet.has(owner)) guardianOf.set(owner, target);
    }
    if (rel["wet_nurse"] !== undefined && childSet.has(owner)) wetNurseOf.set(owner, target);
  }

  const person = (id: number): Person => {
    const r = recOf(id) as Rec;
    const alive = (r["alive_data"] as Rec | undefined) ?? {};
    const land = r["landed_data"] as Rec | undefined;
    const sk = effectiveSkills(q, loc, lookup, id);
    const kinship = kin.relation(playerId, id);
    const female = r["female"] === true;
    const traits = idList(r["traits"])
      .map((t) => loc.traitKey(t))
      .filter((k): k is string => k !== null);
    return {
      id,
      name: fullNameOf(q, loc, r, id),
      age: ageAt(r["birth"], date) ?? 0,
      female,
      skills: sk.effective,
      traits,
      landed: idList(land?.["domain"]).length > 0,
      lowborn: r["dynasty_house"] === undefined,
      hasChildren: idList((r["family_data"] as Rec | undefined)?.["child"]).length > 0,
      health: num(alive["health"]) ?? 0,
      languages: Array.isArray(alive["languages"]) ? alive["languages"].length : 0,
      imprisoned: r["prison_data"] !== undefined,
      relation: id === playerId ? "self" : kinship,
      holds: holds.get(id) ?? null,
      wards: wardCount.get(id) ?? 0,
    };
  };

  const adults = adultIds.map(person);
  const ruler = adults[0]!;
  const nameOf = (id: number) => ({ id, name: fullNameOf(q, loc, recOf(id) ?? undefined, id) });

  const children = childIds
    .map((id) => {
      const r = recOf(id) as Rec;
      const focusType = (((r["alive_data"] as Rec | undefined)?.["focus"] as Rec | undefined)?.[
        "type"
      ] ?? "") as string;
      const m = FOCUS.exec(focusType);
      const focus = (m ? m[1] : null) as Skill | null;
      const guardian = guardianOf.get(id);
      const nurse = wetNurseOf.get(id);
      const traits = idList(r["traits"])
        .map((t) => loc.traitKey(t))
        .filter((k): k is string => k !== null);
      const childhood = traits.filter((t) => CHILDHOOD_TRAITS.includes(t));
      const affinity = FOCI.filter((f) => AFFINITY[f].some((t) => childhood.includes(t)));
      const disaffinity = FOCI.filter((f) => childhood.includes(DISAFFINITY[f]));
      const fit: FocusFit | null = !focus
        ? null
        : affinity.includes(focus as EducationSkill)
          ? "good"
          : disaffinity.includes(focus as EducationSkill)
            ? "bad"
            : "neutral";
      const entry: ChildEntry = {
        childhood,
        fit,
        affinity,
        disaffinity,
        intelligence: childIntelligence(traits),
        id,
        name: fullNameOf(q, loc, r, id),
        age: ageAt(r["birth"], date) ?? 0,
        female: r["female"] === true,
        relation: kin.relation(playerId, id),
        focus,
        skills: effectiveSkills(q, loc, lookup, id).effective,
        guardian: guardian !== undefined ? nameOf(guardian) : null,
        wetNurse: nurse !== undefined ? nameOf(nurse) : null,
      };
      // Guardian: a physically able adult with fewer than two wards (educate_child_interaction).
      // Holding another court position does not matter here. The current guardian is always
      // listed (even below the top `perChild`) so the score can be compared against the best picks.
      const scored: GuardianPick[] = focus
        ? adults
            .filter(
              (a) =>
                !a.imprisoned &&
                !a.traits.includes("incapable") &&
                (a.wards < MAX_WARDS || a.id === guardian),
            )
            .map((a) => ({
              person: a,
              value: educatorScore(a, focus as EducationSkill),
              skill: a.skills[focus],
            }))
            .sort((a, b) => b.value - a.value)
        : [];
      const picks = scored.slice(0, perChild);
      const current = scored.find((p) => p.person.id === guardian);
      if (current && !picks.includes(current)) picks.push(current);
      return { ...entry, picks };
    })
    .sort((a, b) => a.age - b.age);

  const staff = adults.filter((a) => a.id !== playerId);
  const roles = (["tutor", "wet_nurse", "caravan_master"] as GuardianRole[]).map((role) =>
    rankRole(role, staff, ruler),
  );
  return { children, roles };
}
