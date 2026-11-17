import type { Query } from "../parser.js";
import { formatCk3Date } from "../format.js";
import { charName, num, playerIdOf } from "./common.js";

type Rec = Record<string, unknown>;

export interface RaidArmy {
  armyId: number;
  ownerId: number;
  ownerName: string;
  commanderName: string | null;
  /** Province the army stands in (`/units/{unit}/location`). */
  province: number | null;
  /** True when a raid is running (the army links a live `/raid/raid/{id}` entry). */
  active: boolean;
  /** Raw raid progress; the scale is not documented in the save. */
  progress: number | null;
  /** Gold looted so far (`raid_gold`); absent until something was looted. */
  loot: number | null;
  /** Raw `raid_intent.type`, e.g. `pillage_intent_tribal`; null when no intent is set. */
  intent: string | null;
  supply: number | null;
  men: number | null;
  maxMen: number | null;
  /** Date the army was raised (`gathered_date`). */
  raised: string | null;
}

export interface RaidsInfo {
  /** The player's raid-capable armies, active raids first. */
  mine: RaidArmy[];
  /** Other rulers' ACTIVE raids, furthest along first. */
  others: RaidArmy[];
  /** Active raids in the whole save, the player's included. */
  worldActive: number;
}

const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Raids are an army property, not a standalone object: `raid_army=yes` only marks an army that
 * CAN raid, and the raid is running when the army carries `raid=<id>` pointing at a live
 * `/raid/raid/{id}` entry (`none` once it ends). Owner and location live on `/units/{unit}`.
 * Which realm a raided province belongs to is not in the save, so threats against the player
 * cannot be told apart from the rest of the world's raids.
 */
export function extractRaids(q: Query): RaidsInfo {
  const playerId = playerIdOf(q);
  const armies = q.at("/armies/armies");
  if (!isRec(armies)) return { mine: [], others: [], worldActive: 0 };
  const regiments = q.at("/armies/army_regiments");
  const regs = isRec(regiments) ? regiments : {};

  const build = (armyId: number, a: Rec, unit: Rec, raid: Rec | null): RaidArmy => {
    let men: number | null = null;
    let maxMen: number | null = null;
    const ids = Array.isArray(a["regiments"]) ? a["regiments"] : [];
    for (const rid of ids) {
      const cached = (regs[String(rid)] as Rec | undefined)?.["cached"];
      if (!isRec(cached)) continue;
      men = (men ?? 0) + (num(cached["current"]) ?? 0);
      maxMen = (maxMen ?? 0) + (num(cached["max"]) ?? 0);
    }
    const intent = isRec(a["raid_intent"]) ? a["raid_intent"]["type"] : null;
    const commander = num(a["commander"]);
    const ownerId = num(unit["owner"]) as number;
    return {
      armyId,
      ownerId,
      ownerName: charName(q, ownerId),
      commanderName: commander !== null ? charName(q, commander) : null,
      province: num(unit["location"]),
      active: raid !== null,
      progress: raid ? num(raid["progress"]) : null,
      loot: num(a["raid_gold"]),
      intent: typeof intent === "string" ? intent : null,
      supply: num(a["supply"]),
      men,
      maxMen,
      raised: a["gathered_date"] !== undefined ? formatCk3Date(a["gathered_date"]) : null,
    };
  };

  const mine: RaidArmy[] = [];
  const others: RaidArmy[] = [];
  for (const [key, raw] of Object.entries(armies)) {
    if (!isRec(raw)) continue;
    const capable = raw["raid_army"] === true || raw["raid_army"] === "yes";
    const raidId = num(raw["raid"]);
    if (!capable && raidId === null) continue;
    const unitId = num(raw["unit"]);
    const unit = unitId !== null ? q.at(`/units/${unitId}`) : undefined;
    if (!isRec(unit) || num(unit["owner"]) === null) continue;
    const raidEntry = raidId !== null ? q.at(`/raid/raid/${raidId}`) : undefined;
    const raid = isRec(raidEntry) ? raidEntry : null;
    const army = build(Number(key), raw, unit, raid);
    if (army.ownerId === playerId) mine.push(army);
    else if (army.active) others.push(army);
  }

  mine.sort((a, b) => Number(b.active) - Number(a.active) || a.armyId - b.armyId);
  others.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
  return {
    mine,
    others,
    worldActive: others.length + mine.filter((a) => a.active).length,
  };
}
