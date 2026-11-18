import { describe, expect, it } from "vitest";
import {
  errorResult,
  fail,
  loadQuery,
  loadSnapshot,
  ok,
  stamped,
  textResult,
} from "../src/tools/kit.js";

const snap = { date: "1066.1.1", parsedAt: Date.now() } as any;

describe("tool kit", () => {
  it("builds results in the MCP shape", () => {
    expect(textResult("hi")).toEqual({ content: [{ type: "text", text: "hi" }] });
    expect(errorResult("bad")).toEqual({ isError: true, content: [{ type: "text", text: "bad" }] });
    expect(stamped(snap, "body").content[0]!.text).toContain("body");
  });

  it("loadSnapshot turns the cache's { error } into a failed outcome", async () => {
    expect(await loadSnapshot({ get: async () => snap } as any)).toEqual(ok(snap));
    expect(await loadSnapshot({ get: async () => ({ error: "no save" }) } as any)).toEqual(
      fail("no save"),
    );
  });

  it("loadQuery returns null and arrays as values, not errors", async () => {
    const cache = () => ({ memoQuery: async (_k: string, fn: any) => fn({}, {}) }) as any;
    expect(await loadQuery(cache(), "k", () => null)).toEqual(ok(null));
    expect(await loadQuery(cache(), "k", () => [1, 2])).toEqual(ok([1, 2]));
  });

  it("loadQuery turns a cache error into a failed outcome", async () => {
    const cache = { memoQuery: async () => ({ error: "boom" }) } as any;
    expect(await loadQuery(cache, "k", () => 1)).toEqual(fail("boom"));
  });
});
