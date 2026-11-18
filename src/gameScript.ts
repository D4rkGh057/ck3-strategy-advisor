// Paradox script-format parsing (CK3 game files). Pure: no I/O, no lookup state.

export interface RawBlock {
  key: string;
  start: number;
  end: number;
}

const IDENT = /[A-Za-z0-9_.:@-]+/y;

/**
 * Find the `key = { ... }` blocks at depth 0 of a Paradox script file, plus the
 * file's `@name = value` constants. Comments and quoted strings are skipped when
 * matching braces. Scalars at depth 0 (`namespace = foo`) are ignored.
 */
export function parseTopLevel(
  text: string,
  opts: { scalars?: boolean } = {},
): {
  blocks: RawBlock[];
  vars: Map<string, string>;
} {
  const blocks: RawBlock[] = [];
  const vars = new Map<string, string>();
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const skipTrivia = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 35 /* # */) {
        while (i < n && text.charCodeAt(i) !== 10) i++;
      } else if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };

  // i points at '{'; returns the index just past the matching '}'.
  const skipBlock = (): number => {
    let depth = 0;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 35) {
        while (i < n && text.charCodeAt(i) !== 10) i++;
        continue;
      }
      if (c === 34 /* " */) {
        i++;
        while (i < n && text.charCodeAt(i) !== 34 && text.charCodeAt(i) !== 10) i++;
        i++;
        continue;
      }
      if (c === 123) depth++;
      else if (c === 125 && --depth === 0) return ++i;
      i++;
    }
    return n;
  };

  while (i < n) {
    skipTrivia();
    if (i >= n) break;
    IDENT.lastIndex = i;
    const m = IDENT.exec(text);
    if (!m) {
      i++;
      continue;
    }
    const key = m[0];
    const start = i;
    i += key.length;
    skipTrivia();
    if (text[i] !== "=") continue;
    i++;
    skipTrivia();
    if (text[i] === "{") {
      const end = skipBlock();
      blocks.push({ key, start, end });
    } else {
      const vs = i;
      if (text[i] === "@" && text[i + 1] === "[") {
        // `@[ a * b ]` formulas may contain spaces; they run to the closing bracket
        while (i < n && text[i] !== "]") i++;
        i++;
      } else {
        while (i < n && !/\s/.test(text[i]!)) i++;
      }
      if (key.startsWith("@")) vars.set(key, text.slice(vs, i));
      else if (opts.scalars) blocks.push({ key, start, end: i });
    }
  }
  return { blocks, vars };
}

// `@name` constants are file-local. Inside `@[ ... ]` formulas the names appear
// without the `@`; when every name resolves to a number the formula is evaluated
// and shown as `128 /* @[a * 1.28] */`, otherwise it is left as written.
export function substituteVars(block: string, vars: Map<string, string>): string {
  if (!block.includes("@")) return block;
  const withFormulas = block.replace(/@\[([^\]]*)\]/g, (whole, expr: string) => {
    const filled = expr.replace(/[A-Za-z_]\w*/g, (id) => vars.get(`@${id}`) ?? id);
    if (!/^[\d.\s+\-*/()]+$/.test(filled)) return whole;
    try {
      const value = Function(`"use strict"; return (${filled});`)() as unknown;
      if (typeof value === "number" && Number.isFinite(value))
        return `${Math.round(value * 10000) / 10000} /* ${whole} */`;
    } catch {
      // fall through: leave the formula as written
    }
    return whole;
  });
  return withFormulas.replace(/@[A-Za-z_]\w*/g, (v) => vars.get(v) ?? v);
}

export const SKILLS = [
  "diplomacy",
  "martial",
  "stewardship",
  "intrigue",
  "learning",
  "prowess",
] as const;
export type Skill = (typeof SKILLS)[number];
export type SkillDelta = Partial<Record<Skill, number>>;

export interface TraitSkills {
  /** Skill modifiers that always apply. */
  fixed: SkillDelta;
  /** Extra modifiers unlocked at an XP threshold (lifestyle/education `track`). */
  tracks: { threshold: number; bonus: SkillDelta }[];
  /** True if a skill modifier was a named value rather than a number (not counted). */
  unresolved: boolean;
}

const SKILL_LINE = new RegExp(`^\\s*(${SKILLS.join("|")})\\s*=\\s*(\\S+)\\s*$`);

// Read a trait block's skill modifiers: the ones directly inside the trait, and
// the ones inside `track = { <xp> = { ... } }` tiers. Only plain `skill = N`
// lines are counted; modifiers that depend on conditions or scripted values
// (e.g. `diplomacy_per_prestige_level`) are not.
export function parseTraitSkills(block: string): TraitSkills {
  const out: TraitSkills = { fixed: {}, tracks: [], unresolved: false };
  let depth = 0;
  let inTrack = false;
  let trackDepth = 0;
  let tier: { threshold: number; bonus: SkillDelta } | null = null;
  const add = (target: SkillDelta, skill: Skill, raw: string) => {
    const value = Number(raw);
    if (Number.isFinite(value)) target[skill] = (target[skill] ?? 0) + value;
    else out.unresolved = true;
  };
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/#.*$/, "");
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    if (!inTrack && depth === 1 && /^\s*track\s*=\s*\{/.test(line)) {
      inTrack = true;
      trackDepth = depth;
    } else if (inTrack && depth === trackDepth + 1) {
      const t = /^\s*(\d+)\s*=\s*\{(.*)$/.exec(line);
      if (t) {
        tier = { threshold: Number(t[1]), bonus: {} };
        out.tracks.push(tier);
        // a whole tier on one line: `50 = { diplomacy = 1 }`
        for (const m of t[2]!.matchAll(/(\w+)\s*=\s*(-?[\w.]+)/g)) {
          if ((SKILLS as readonly string[]).includes(m[1]!)) add(tier.bonus, m[1] as Skill, m[2]!);
        }
      }
    } else if (inTrack && tier && depth === trackDepth + 2) {
      const m = SKILL_LINE.exec(line);
      if (m) add(tier.bonus, m[1] as Skill, m[2]!);
    } else if (!inTrack && depth === 1) {
      const m = SKILL_LINE.exec(line);
      if (m) add(out.fixed, m[1] as Skill, m[2]!);
    }
    depth += opens - closes;
    if (inTrack && depth <= trackDepth) {
      inTrack = false;
      tier = null;
    }
  }
  return out;
}
