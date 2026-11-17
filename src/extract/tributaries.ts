import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { fullName } from "./names.js";
import { idList, num, vassalContract } from "./common.js";

export interface RulerLink {
  id: number;
  name: string;
}

type Rec = Record<string, unknown>;

// Tributaries and vassals share `/vassal_contracts`; only `contract_group` tells them apart
// (`tributary_subjugated`, `tributary_nomadic`, `tributary_mandala`, ... vs `tribal_vassal`, ...).
function isTributaryContract(c: Rec): boolean {
  const g = c["contract_group"];
  return typeof g === "string" && g.startsWith("tributary_");
}

/** Rulers who pay tribute to `holderId`. Tributaries are not vassals: they are independent. */
export function collectTributaries(q: Query, loc: Localizer, holderId: number): RulerLink[] {
  const out: RulerLink[] = [];
  const cids = idList(q.at(`/living/${holderId}/landed_data/tributary_contracts`));
  for (const cid of cids) {
    const c = vassalContract(q, cid);
    const vassal = c ? num(c["vassal"]) : null;
    if (!c || vassal === null || !isTributaryContract(c)) continue;
    out.push({ id: vassal, name: fullName(q, loc, vassal) });
  }
  return out;
}

/**
 * The ruler `holderId` pays tribute to, or null. The tributary's own record holds no link to
 * the overlord, so this scans the contract database (1.20: `database`, older saves: `active`;
 * vacated slots are the string "none").
 */
export function findOverlord(q: Query, loc: Localizer, holderId: number): RulerLink | null {
  for (const base of ["database", "active"]) {
    const db = q.at(`/vassal_contracts/${base}`);
    if (!db || typeof db !== "object") continue;
    for (const raw of Object.values(db as Rec)) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as Rec;
      if (num(c["vassal"]) !== holderId || !isTributaryContract(c)) continue;
      const liege = num(c["liege"]);
      if (liege !== null) return { id: liege, name: fullName(q, loc, liege) };
    }
  }
  return null;
}
