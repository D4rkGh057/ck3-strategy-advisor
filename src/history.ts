import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Snapshot } from "./snapshot.js";

/** One point of a playthrough's timeline: the few realm numbers worth tracking over time. */
export interface HistoryEntry {
  /** `playthrough_timer`: monotonic within a playthrough, used as the ordering key. */
  timer: number;
  date: string;
  ruler: string;
  gold: number | null;
  prestige: number | null;
  piety: number | null;
  income: number | null;
  levy: number | null;
  strength: number | null;
  titles: number;
  holdings: number;
  vassals: number;
}

export function defaultHistoryDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CK3_HISTORY_DIR ?? join(homedir(), ".ck3-advisor", "history");
}

export function entryFromSnapshot(snap: Snapshot): HistoryEntry {
  const o = snap.overview;
  return {
    timer: snap.playthrough.timer ?? 0,
    date: snap.date,
    ruler: o.rulerName,
    gold: o.gold,
    prestige: o.prestigeLifetime,
    piety: o.piety,
    income: o.income,
    levy: snap.military.levy,
    strength: snap.military.strength,
    titles: snap.titles.total,
    holdings: o.holdings,
    vassals: snap.vassalCount,
  };
}

/**
 * Per-playthrough timeline stored as `<dir>/<playthrough_id>.json`. This is the only thing the
 * server writes; it never touches the save or the game. Entries are keyed by timer, so
 * re-reading the same save is idempotent. Loading an older save and playing on overwrites
 * overlapping timers but never deletes the later tail.
 */
export class HistoryStore {
  private queues = new Map<string, Promise<void>>();

  constructor(private dir: string) {}

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async read(id: string): Promise<HistoryEntry[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file(id), "utf8"));
      return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
    } catch {
      return []; // missing or corrupt: start over rather than fail a tool call
    }
  }

  async record(snap: Snapshot): Promise<void> {
    const { id, timer } = snap.playthrough;
    // Ids become file names, so accept only the UUID shape the game writes.
    if (!id || timer === null || !/^[0-9a-f-]{8,64}$/i.test(id)) return;
    // Serialize read-modify-write per playthrough so concurrent records don't clobber each other.
    const prev = this.queues.get(id) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      const entries = (await this.read(id)).filter((e) => e.timer !== timer);
      entries.push(entryFromSnapshot(snap));
      entries.sort((a, b) => a.timer - b.timer);
      await mkdir(this.dir, { recursive: true });
      const tmp = `${this.file(id)}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, JSON.stringify(entries));
      await rename(tmp, this.file(id));
    });
    const tail = run.catch(() => {});
    this.queues.set(id, tail);
    try {
      await run;
    } finally {
      if (this.queues.get(id) === tail) this.queues.delete(id);
    }
  }
}

function cell(v: number | null): string {
  return v === null ? "?" : String(Math.round(v * 10) / 10);
}
function delta(a: number | null, b: number | null): string {
  if (a === null || b === null) return "?";
  const d = Math.round((b - a) * 10) / 10;
  return d > 0 ? `+${d}` : String(d);
}

function sample<T>(items: T[], n: number): T[] {
  if (items.length <= n || n < 2) return items.length <= n ? items : items.slice(-1);
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.round((i * (items.length - 1)) / (n - 1))]!);
  return out;
}

export function renderHistory(entries: HistoryEntry[], limit: number): string {
  if (entries.length === 0) return "No history recorded yet for this playthrough.";
  const shown = sample(entries, limit);
  const rows = shown.map(
    (e) =>
      `| ${e.date} | ${e.ruler} | ${cell(e.gold)} | ${cell(e.prestige)} | ${cell(e.piety)} | ${cell(e.income)} | ${cell(e.strength)} | ${e.titles} | ${e.vassals} |`,
  );
  const first = entries[0]!;
  const last = entries[entries.length - 1]!;
  let body =
    `# Playthrough history — ${entries.length} point${entries.length === 1 ? "" : "s"}\n\n` +
    "| Date | Ruler | Gold | Lifetime prestige | Piety | Income/mo | Strength | Titles | Direct vassals |\n" +
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n" +
    rows.join("\n");
  if (shown.length < entries.length) body += `\n\n_Showing ${shown.length} of ${entries.length}._`;
  if (entries.length > 1) {
    body +=
      `\n\n**Change ${first.date} → ${last.date}:** gold ${delta(first.gold, last.gold)}, ` +
      `lifetime prestige ${delta(first.prestige, last.prestige)}, piety ${delta(first.piety, last.piety)}, ` +
      `strength ${delta(first.strength, last.strength)}, titles ${delta(first.titles, last.titles)}, ` +
      `vassals ${delta(first.vassals, last.vassals)}`;
  }
  body += "\n\n_Only saves read by this server are recorded; gaps mean the save was never queried._";
  return body;
}
