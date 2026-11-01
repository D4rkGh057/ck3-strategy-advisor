import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import type { GameLookup } from "../gameLookup.js";

export interface FaithInfo {
  /** The player's rite (the branch they belong to), e.g. "Insularismo". */
  riteName: string | null;
  /** The base faith the rite belongs to, e.g. "Catolicismo". */
  faithName: string | null;
  tenets: string[];
  doctrines: string[];
  /** Doctrines the rite adds on top of the base faith. */
  addedDoctrines: string[];
  /** Doctrines of the base faith the rite drops. */
  removedDoctrines: string[];
}

/** jomini returns a lone repeated key as a string and several as an array. */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function text(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** Fallback when no localization is loaded: `doctrine_gender_male_dominated` -> "Gender male dominated". */
function humanize(key: string): string {
  const words = key.replace(/^(doctrine|tenet)_/, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function label(loc: Localizer, key: string): string {
  const name = `${key}_name`;
  return loc.has(name) ? loc.text(name) : humanize(key);
}

/**
 * A doctrine's localized value alone ("Shunned", "Criminal") is ambiguous, so prefix the group
 * it belongs to ("Male Adultery: Shunned"). The group is read from the game files; without them
 * (or when the group has no localized name) the value is shown alone rather than guessing one.
 */
function doctrineLabel(loc: Localizer, lookup: GameLookup | null, key: string): string {
  const value = label(loc, key);
  const entry = lookup?.get("doctrine", key);
  const group = entry ? /doctrine_group_type\s*=\s*([\w.-]+)/.exec(entry.text)?.[1] : undefined;
  if (!group || !loc.has(`${group}_name`)) return value;
  const groupName = loc.text(`${group}_name`);
  return groupName === value ? value : `${groupName}: ${value}`;
}

/**
 * Tenets and doctrines of the player's own rite. The rite carries its own copy (they can differ
 * from the base faith), so it is the authoritative source; the base faith is used only to say
 * what the rite changed.
 */
export function extractFaith(
  q: Query,
  loc: Localizer,
  lookup: GameLookup | null = null,
): FaithInfo {
  const empty: FaithInfo = {
    riteName: null,
    faithName: null,
    tenets: [],
    doctrines: [],
    addedDoctrines: [],
    removedDoctrines: [],
  };
  const pid = q.at("/played_character/character");
  const rite = q.at(`/living/${pid}/rite`);
  if (rite === undefined) return empty;

  const data = q.at(`/rites/database/${rite}/data`) as Record<string, unknown> | undefined;
  if (!data) return empty;

  const faithId = q.at(`/rites/database/${rite}/faith`);
  const base = faithId === undefined ? undefined : q.at(`/faiths/database/${faithId}`);
  const baseRec = base as Record<string, unknown> | undefined;

  const doctrines = strings(data.doctrine);
  const baseDoctrines = strings(baseRec?.doctrine);
  return {
    riteName: text(data.name),
    faithName: text(baseRec?.name),
    tenets: strings(data.tenet).map((t) => label(loc, t)),
    doctrines: doctrines.map((d) => doctrineLabel(loc, lookup, d)),
    addedDoctrines: baseRec
      ? doctrines.filter((d) => !baseDoctrines.includes(d)).map((d) => doctrineLabel(loc, lookup, d))
      : [],
    removedDoctrines: baseRec
      ? baseDoctrines.filter((d) => !doctrines.includes(d)).map((d) => doctrineLabel(loc, lookup, d))
      : [],
  };
}
