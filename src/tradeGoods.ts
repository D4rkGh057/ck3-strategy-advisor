import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The game's trade goods in definition order. The save's `good_balances` is keyed by position in
 * this list (verified against route transactions on a Silk and Silver save), so the order must be
 * read from the game files; null when they are unavailable and names cannot be trusted.
 */
export function loadTradeGoods(gameRoot: string | null): string[] | null {
  if (!gameRoot) return null;
  const dir = join(gameRoot, "common", "trade", "trade_good_types");
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".txt"))
      .sort();
  } catch {
    return null;
  }
  const goods: string[] = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const m of text.matchAll(/^(trade_good_\w+)\s*=\s*\{/gm)) goods.push(m[1]!);
  }
  return goods.length > 0 ? goods : null;
}

export interface CategoryDef {
  /** Trade goods the category covers (a good can belong to several categories). */
  goods: string[];
  /** `per_level_interval` sell price modifier added per level (0.001 = +0.1% per level). */
  sellPerLevel: number;
  /** `per_level_interval` buy price modifier per level (negative = cheaper to buy). */
  buyPerLevel: number;
}

export interface CategoryModel {
  /** Category keys in definition order: the save's `category_xp` array follows this order. */
  order: string[];
  defs: Map<string, CategoryDef>;
}

/** Text of the `{ ... }` block that opens at `open` (the index of its `{`), braces balanced. */
function blockAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

/**
 * Trade good categories from `common/trade/trade_good_categories` (files sorted): their order, the
 * goods each covers and the per-level price modifiers of its expertise track. Milestone bonuses are
 * not read. Null when the game files are unavailable.
 */
export function loadCategoryModel(gameRoot: string | null): CategoryModel | null {
  if (!gameRoot) return null;
  const dir = join(gameRoot, "common", "trade", "trade_good_categories");
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".txt"))
      .sort();
  } catch {
    return null;
  }
  const order: string[] = [];
  const defs = new Map<string, CategoryDef>();
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const m of text.matchAll(/^(trade_category_\w+)\s*=\s*\{/gm)) {
      const key = m[1]!;
      const body = blockAt(text, m.index! + m[0].length - 1);
      const goods = [
        ...(/trade_goods\s*=\s*\{([^}]*)\}/.exec(body)?.[1] ?? "").matchAll(/trade_good_\w+/g),
      ].map((g) => g[0]);
      const perLevel = /per_level_interval\s*=\s*\{([^}]*)\}/.exec(body)?.[1] ?? "";
      const mod = (kind: string): number =>
        Number(new RegExp(`${key}_${kind}_price_mult\\s*=\\s*(-?[\\d.]+)`).exec(perLevel)?.[1] ?? 0);
      order.push(key);
      defs.set(key, { goods, sellPerLevel: mod("sell"), buyPerLevel: mod("buy") });
    }
  }
  return order.length > 0 ? { order, defs } : null;
}

/** Category keys in the game's order (see `loadCategoryModel`). */
export function loadTradeCategories(gameRoot: string | null): string[] | null {
  return loadCategoryModel(gameRoot)?.order ?? null;
}

export const DEFAULT_XP_LEVEL_THRESHOLD = 150;

/** `TRADE_CATEGORY_XP_LEVEL_THRESHOLD` from the game's defines (XP per trade category level). */
export function loadXpLevelThreshold(gameRoot: string | null): number {
  if (!gameRoot) return DEFAULT_XP_LEVEL_THRESHOLD;
  try {
    const text = readFileSync(join(gameRoot, "common", "defines", "00_defines.txt"), "utf8");
    const m = /TRADE_CATEGORY_XP_LEVEL_THRESHOLD\s*=\s*(\d+(?:\.\d+)?)/.exec(text);
    return m ? Number(m[1]) : DEFAULT_XP_LEVEL_THRESHOLD;
  } catch {
    return DEFAULT_XP_LEVEL_THRESHOLD;
  }
}
