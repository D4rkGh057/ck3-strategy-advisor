import type { SnapshotCache } from "../cache.js";
import type { Query } from "../parser.js";
import type { ParentIndexStore } from "../extract/family.js";
import type { Snapshot } from "../snapshot.js";
import { stamp } from "../format.js";

// The one contract every tool handler follows: load data as an Outcome, return a ToolResult.
// Errors are values here, so the compiler forces each handler to deal with them (the cache itself
// reports failures as `{ error }`; the loaders below are the only place that shape is inspected).

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

export type ToolResult = { isError?: true; content: { type: "text"; text: string }[] };

export const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

export const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
export const fail = (error: string): Outcome<never> => ({ ok: false, error });

export const textResult = (text: string): ToolResult => ({ content: [{ type: "text", text }] });

/** A failure for the MCP client: tools never throw, they return this. */
export const errorResult = (error: string): ToolResult => ({
  isError: true,
  content: [{ type: "text", text: error }],
});

/** A successful reply stamped with the save's date and age. */
export const stamped = (snap: Snapshot, body: string): ToolResult => textResult(stamp(snap, body));

export async function loadSnapshot(cache: SnapshotCache): Promise<Outcome<Snapshot>> {
  const snap = await cache.get();
  return "error" in snap ? fail(snap.error) : ok(snap);
}

/**
 * Runs an extractor against the current save, kept per save under `key` (see `memoQuery`: the key
 * must name the extractor and every argument it depends on). Any result is a valid value,
 * including null or an array, because it is wrapped before it can meet the cache's `{ error }`.
 */
export async function loadQuery<T>(
  cache: SnapshotCache,
  key: string,
  extract: (q: Query, shared: ParentIndexStore) => T,
): Promise<Outcome<T>> {
  const res = await cache.memoQuery(key, (q, shared) => ({ data: extract(q, shared) }));
  return "error" in res ? fail(res.error) : ok(res.data);
}

/** Like `loadQuery` but not kept: for work that depends on per-call data and mutates its own copy. */
export async function loadFresh<T>(
  cache: SnapshotCache,
  extract: (q: Query, shared: ParentIndexStore) => T,
): Promise<Outcome<T>> {
  const res = await cache.query((q, shared) => ({ data: extract(q, shared) }));
  return "error" in res ? fail(res.error) : ok(res.data);
}

/** The save's gamestate as text, converted once per save by the cache. */
export async function loadRawText(cache: SnapshotCache): Promise<Outcome<string>> {
  const text = await cache.rawGamestateText();
  return typeof text === "string" ? ok(text) : fail(text.error);
}
