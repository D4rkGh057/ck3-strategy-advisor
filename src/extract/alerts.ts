import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { charName, playerIdOf } from "./common.js";
import { resolveTitleName } from "./titleUtils.js";

export interface AlertTarget {
  kind: "character" | "title" | "decision";
  /** Numeric save id; for a decision, its script key. */
  id: number | string;
  name: string;
}
export interface Alert {
  type: string;
  label: string;
  targets: AlertTarget[];
}

// The game's own "important actions" panel (top-right nudges: unmarried heir,
// unused casus belli, unstationed men-at-arms, ...). Stored per player in
// /important_action_manager/active; each entry's scope.event_targets names the
// character/title it is about (the `actor` is always the player and is skipped).
export function extractAlerts(q: Query, loc: Localizer): Alert[] {
  const playerId = playerIdOf(q);
  const active = q.at("/important_action_manager/active") as Record<string, unknown> | undefined;
  if (!active || typeof active !== "object") return [];

  const byType = new Map<string, Alert>();
  for (const raw of Object.values(active)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (entry["character"] !== playerId || entry["visible"] === false) continue;
    const type = entry["important_action_type"];
    if (typeof type !== "string") continue;

    let alert = byType.get(type);
    if (!alert) {
      alert = { type, label: loc.text(type), targets: [] };
      byType.set(type, alert);
    }

    const scope = entry["scope"] as Record<string, unknown> | undefined;
    const targets = scope?.["event_targets"] as Record<string, unknown> | undefined;
    for (const [role, t] of Object.entries(targets ?? {})) {
      if (role === "actor" || !t || typeof t !== "object") continue;
      const { type: kind, identity, key } = t as { type?: string; identity?: number; key?: string };
      // The game repeats an action per role (e.g. demand vs exchange hostage); list each target once.
      if (kind === "decision") {
        // Decisions are addressed by script key (no numeric identity), e.g. "hold_court_decision".
        if (typeof key === "string" && !alert.targets.some((x) => x.id === key))
          alert.targets.push({ kind: "decision", id: key, name: loc.text(key) });
        continue;
      }
      if (typeof identity !== "number" || alert.targets.some((x) => x.id === identity)) continue;
      if (kind === "char" && identity !== playerId)
        alert.targets.push({ kind: "character", id: identity, name: charName(q, identity) });
      // Titles are stored as type "lt" (landed title) in important actions.
      else if (kind === "lt" || kind === "title")
        alert.targets.push({
          kind: "title",
          id: identity,
          name: resolveTitleName(q, loc, identity),
        });
    }
  }
  return [...byType.values()];
}
