import type { Source, SaveRef } from "./source.js";
import type { Localizer } from "./localization.js";
import { extractGamestate, IronmanError } from "./envelope.js";
import { buildSnapshot, type Snapshot } from "./snapshot.js";
import { queryGamestate, type Query } from "./parser.js";
import { GameData } from "./gameData.js";
import { GameLookup } from "./gameLookup.js";
import type { HistoryStore } from "./history.js";
import type { ParentIndexStore } from "./extract/family.js";

export class SnapshotCache {
  private current: Snapshot | null = null;
  private key = "";
  private gamestate: Buffer | null = null;
  private gamestateText: string | null = null;
  private inFlight: Promise<Snapshot | { error: string }> | null = null;
  private inFlightKey = "";
  private memos = new Map<string, Promise<unknown>>();
  /** Derived data shared between tools for the current save; replaced whenever a new save is built. */
  private shared: ParentIndexStore = {};
  /** Index over the game's script files (rules lookups, trait skill modifiers). */
  readonly lookup: GameLookup;

  constructor(
    private source: Source,
    readonly loc: Localizer,
    readonly game: GameData = new GameData(null),
    /** Optional timeline store; every successfully built save is recorded (best effort). */
    readonly history: HistoryStore | null = null,
  ) {
    this.lookup = new GameLookup(game.root, loc);
  }

  /** Display name for a province id: its barony's localized name, else "province N". */
  provinceName(id: number): string {
    const barony = this.game.provinceBarony.get(id);
    return barony ? this.loc.resolve(barony) : `province ${id}`;
  }

  async get(): Promise<Snapshot | { error: string }> {
    const ref = await this.source.latest();
    if (!ref)
      return this.current ?? { error: "No CK3 save found. Save your game, then ask again." };
    const k = `${ref.path}:${ref.mtimeMs}`;
    if (k === this.key && this.current) return this.current;
    // Coalesce concurrent builds for the same save into one parse.
    if (this.inFlight && this.inFlightKey === k) return this.inFlight;
    this.inFlightKey = k;
    this.inFlight = this.build(ref, k);
    try {
      return await this.inFlight;
    } finally {
      if (this.inFlightKey === k) this.inFlight = null;
    }
  }

  private async build(ref: SaveRef, k: string): Promise<Snapshot | { error: string }> {
    try {
      const gs = extractGamestate(await this.source.read(ref));
      const snap = await buildSnapshot(gs, this.loc);
      // commit all derived state together, only on success
      this.gamestate = gs;
      this.gamestateText = null; // lazily materialized by rawGamestateText()
      this.current = snap;
      this.memos = new Map();
      this.shared = {};
      this.key = k;
      // A failed write must never fail the tool call that triggered the build.
      void this.history?.record(snap).catch(() => {});
      return snap;
    } catch (e) {
      if (e instanceof IronmanError) return { error: e.message };
      if (this.current) return this.current; // serve last good on transient/mid-write failure
      return { error: `Could not read save: ${(e as Error).message}` };
    }
  }

  /**
   * `fn` also receives the shared store of the save it runs against. Both are read in the same
   * synchronous step, so a rebuild in between cannot pair one save's data with another's store.
   */
  async query<T>(fn: (q: Query, shared: ParentIndexStore) => T): Promise<T | { error: string }> {
    const snap = await this.get();
    if ("error" in snap) return { error: snap.error };
    const gamestate = this.gamestate;
    const shared = this.shared;
    if (!gamestate) return { error: "No gamestate available." };
    return queryGamestate(gamestate, (q) => fn(q, shared));
  }

  /**
   * Like `query`, but keeps the result for the current save. The key must name the extractor
   * AND every argument it depends on; results are shared between callers, so treat them as
   * read-only. Dropped when a newer save is built; failed runs are never kept.
   */
  async memoQuery<T>(
    key: string,
    fn: (q: Query, shared: ParentIndexStore) => T,
  ): Promise<T | { error: string }> {
    const snap = await this.get();
    if ("error" in snap) return { error: snap.error };
    const hit = this.memos.get(key);
    if (hit) return hit as Promise<T | { error: string }>;
    const memos = this.memos; // a rebuild swaps the map, so a stale run cannot poison the new save
    const run = this.query(fn);
    memos.set(key, run);
    try {
      const result = await run;
      if (result !== null && typeof result === "object" && "error" in result) memos.delete(key);
      return result;
    } catch (e) {
      memos.delete(key);
      throw e;
    }
  }

  async rawGamestate(): Promise<Buffer | { error: string }> {
    const snap = await this.get();
    if ("error" in snap) return { error: snap.error };
    if (!this.gamestate) return { error: "No gamestate available." };
    return this.gamestate;
  }

  // FIX D: convert the gamestate Buffer to text ONCE per save, not per find_character call.
  async rawGamestateText(): Promise<string | { error: string }> {
    const snap = await this.get();
    if ("error" in snap) return { error: snap.error };
    if (!this.gamestate) return { error: "No gamestate available." };
    if (this.gamestateText === null) this.gamestateText = this.gamestate.toString("utf8");
    return this.gamestateText;
  }
}
