import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import type { GameLookup } from "../gameLookup.js";
import { formatCk3Date } from "../format.js";
import { ageAt, idList, num, playerIdOf } from "./common.js";
import { Kin, buildParentIndex, type ParentIndexStore } from "./family.js";
import { fullNameOf } from "./names.js";
import { effectiveSkills, type EffectiveSkills } from "./skills.js";
import { resolveTitleName, titleTierFromKey, type TitleTier } from "./titleUtils.js";

type Rec = Record<string, unknown>;

export interface RulerInfo {
  titles: number;
  topTier: TitleTier;
  strength: number | null;
  gold: number | null;
}

export interface Prisoner {
  id: number;
  name: string;
  age: number | null;
  female: boolean;
  /** Raw save value: "dungeon" or "house_arrest". */
  type: string;
  since: string;
  years: number | null;
  imprisonerId: number;
  imprisonerName: string;
  /** Kinship to the player; null when the save shows no close tie. */
  kinship: string | null;
  /** Whose court the prisoner belongs to (court_data/employer), if anyone's. */
  court: { id: number; name: string } | null;
  ruler: RulerInfo | null;
  health: number | null;
  skills: EffectiveSkills;
  traits: string[];
  /** Titles the player holds that this character has a claim on. */
  claimsOnYou: string[];
  isHeir: boolean;
  leads: string[];
}

export interface PrisonersInfo {
  held: Prisoner[];
  /** Close kin of the player that someone else holds. */
  kinHeldByOthers: Prisoner[];
  /** Set when the player themselves is a prisoner. */
  playerImprisoned: { imprisonerName: string; type: string; since: string } | null;
  /** Everyone imprisoned in the save, all realms (context only). */
  worldTotal: number;
}

const TIER_ORDER: TitleTier[] = ["barony", "county", "duchy", "kingdom", "empire"];

/**
 * Prisoners the player holds, with what the save shows that matters for deciding their fate, and
 * close kin held by other rulers. The recommendations are leads drawn only from visible facts
 * (kinship, claims, rank, court); the ransom price, tyranny/dread effects and which interactions
 * are currently allowed are not stored in the save.
 */
export function extractPrisoners(
  q: Query,
  loc: Localizer,
  lookup: GameLookup | null,
  store?: ParentIndexStore,
): PrisonersInfo | null {
  loc.setTraitLookup((q.at("/traits_lookup") as string[] | null | undefined) ?? null);
  const playerId = playerIdOf(q);
  const date = q.at("/date");
  const living = (q.at("/living") as Record<string, unknown> | undefined) ?? {};
  const recOf = (id: number): Rec | null => {
    const raw = living[String(id)];
    const r = Array.isArray(raw) ? raw[0] : raw;
    return r && typeof r === "object" ? (r as Rec) : null;
  };
  const player = recOf(playerId);
  if (!player) return null;

  const prisonOf = (r: Rec): Rec | null => {
    const p = (r["alive_data"] as Rec | undefined)?.["prison_data"];
    return p && typeof p === "object" ? (p as Rec) : null;
  };

  // Pass 1 on raw ids: the save holds hundreds of prisoners, most of them none of our business.
  const inJail: { id: number; r: Rec; prison: Rec; imprisoner: number }[] = [];
  for (const [key, raw] of Object.entries(living)) {
    const r = Array.isArray(raw) ? raw[0] : raw;
    if (!r || typeof r !== "object") continue;
    const prison = prisonOf(r as Rec);
    const imprisoner = num(prison?.["imprisoner"]);
    if (!prison || imprisoner === null) continue;
    inJail.push({ id: Number(key), r: r as Rec, prison, imprisoner });
  }

  const kin = new Kin(q, buildParentIndex(q, living, store));
  const myHouse = player["dynasty_house"];
  const myTitles = idList((player["landed_data"] as Rec | undefined)?.["domain"]);
  const myTitleSet = new Set(myTitles);
  const heirs = new Set(idList((player["landed_data"] as Rec | undefined)?.["succession"]));

  const kinshipOf = (id: number, r: Rec): string | null => {
    const rel = kin.relation(playerId, id);
    if (rel !== "relative") return rel;
    return myHouse !== undefined && r["dynasty_house"] === myHouse ? "same house" : null;
  };

  const nameOf = (id: number) => {
    const r = recOf(id);
    return r ? fullNameOf(q, loc, r, id) : String(id);
  };

  const build = (e: (typeof inJail)[number], kinship: string | null): Prisoner => {
    const { id, r, prison, imprisoner } = e;
    const alive = (r["alive_data"] as Rec | undefined) ?? {};
    const land = r["landed_data"] as Rec | undefined;
    const since = formatCk3Date(prison["date"]);

    const domain = idList(land?.["domain"]);
    let ruler: RulerInfo | null = null;
    if (domain.length > 0) {
      let top = 0;
      for (const t of domain) {
        const key = q.at(`/landed_titles/landed_titles/${t}/key`);
        const tier = typeof key === "string" ? titleTierFromKey(key) : "other";
        top = Math.max(top, TIER_ORDER.indexOf(tier));
      }
      const gold = alive["gold"];
      ruler = {
        titles: domain.length,
        topTier: TIER_ORDER[top] ?? "barony",
        strength: num(land?.["current_strength"]) ?? num(land?.["strength"]),
        gold: num(gold) ?? num((gold as Rec | undefined)?.["value"]),
      };
    }

    const claimsOnYou = (Array.isArray(alive["claim"]) ? (alive["claim"] as Rec[]) : [])
      .map((c) => num(c?.["title"]))
      .filter((t): t is number => t !== null && myTitleSet.has(t))
      .map((t) => resolveTitleName(q, loc, t));

    const employer = num((r["court_data"] as Rec | undefined)?.["employer"]);
    const court =
      employer !== null && employer !== id ? { id: employer, name: nameOf(employer) } : null;

    const p: Prisoner = {
      id,
      name: fullNameOf(q, loc, r, id),
      age: ageAt(r["birth"], date),
      female: r["female"] === true,
      type: typeof prison["type"] === "string" ? prison["type"] : "unknown",
      since,
      years: ageAt(prison["date"], date),
      imprisonerId: imprisoner,
      imprisonerName: nameOf(imprisoner),
      kinship,
      court,
      ruler,
      health: num(alive["health"]),
      skills: effectiveSkills(q, loc, lookup, id),
      traits: idList(r["traits"])
        .map((t) => loc.traitKey(t))
        .filter((k): k is string => k !== null),
      claimsOnYou,
      isHeir: heirs.has(id),
      leads: [],
    };
    return p;
  };

  const held: Prisoner[] = [];
  const kinHeldByOthers: Prisoner[] = [];
  let playerImprisoned: PrisonersInfo["playerImprisoned"] = null;

  for (const e of inJail) {
    if (e.id === playerId) {
      playerImprisoned = {
        imprisonerName: nameOf(e.imprisoner),
        type: typeof e.prison["type"] === "string" ? e.prison["type"] : "unknown",
        since: formatCk3Date(e.prison["date"]),
      };
      continue;
    }
    if (e.imprisoner === playerId) {
      const p = build(e, kinshipOf(e.id, e.r));
      p.leads = leadsFor(p);
      held.push(p);
    } else {
      // Only close family is worth a line; a faraway cadet of the house is noise.
      const k = kinshipOf(e.id, e.r);
      if (k === null || !CLOSE_KIN.has(k)) continue;
      const p = build(e, k);
      p.leads = [
        `${k} of yours held by ${p.imprisonerName}: rescue candidate (ransom, negotiated release, or a war to free them).`,
      ];
      kinHeldByOthers.push(p);
    }
  }

  // Longest-held first: those are the ones that have gone unresolved.
  held.sort((a, b) => (b.years ?? 0) - (a.years ?? 0));
  return { held, kinHeldByOthers, playerImprisoned, worldTotal: inJail.length };
}

const CLOSE_KIN = new Set([
  "child",
  "grandchild",
  "spouse",
  "parent",
  "sibling",
  "half-sibling",
  "grandparent",
]);

/** Leads drawn only from facts visible in the save. Order matters: most decisive first. */
export function leadsFor(p: Prisoner): string[] {
  const out: string[] = [];
  if (p.claimsOnYou.length > 0)
    out.push(
      `Holds a claim on your ${p.claimsOnYou.join(", ")}: once free, they can become a figurehead for claimant factions or wars. Weigh that risk before releasing.`,
    );
  if (p.kinship && CLOSE_KIN.has(p.kinship))
    out.push(
      `${p.kinship} of yours: a release or marriage candidate rather than ransom fodder.`,
    );
  if (p.ruler && !(p.kinship && CLOSE_KIN.has(p.kinship))) {
    const bits = [
      p.ruler.strength !== null ? `army ~${Math.round(p.ruler.strength)}` : null,
      p.ruler.gold !== null ? `gold ~${Math.round(p.ruler.gold)}` : null,
    ].filter(Boolean);
    out.push(
      `Ruler of ${p.ruler.titles} title(s), highest ${p.ruler.topTier}${bits.length ? ` (${bits.join(", ")})` : ""}: a ransom candidate, since a ruler has gold and a realm to pay. Ransom price is not in the save.`,
    );
  } else if (p.court && !(p.kinship && CLOSE_KIN.has(p.kinship))) {
    out.push(
      `Belongs to ${p.court.name}'s court: ${p.court.name} is the natural buyer for a ransom or a release deal.`,
    );
  }
  if (out.length === 0)
    out.push("Landless, no claims on your titles and no visible ties: no leverage in the save.");
  return out;
}
