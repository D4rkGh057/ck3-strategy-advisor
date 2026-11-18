import { describe, it, expect } from "vitest";
import { registerCouncilTool } from "../src/tools/council.js";

async function runCouncil(government: string | null): Promise<string> {
  const snap = {
    date: "1066.12.9",
    parsedAt: Date.now(),
    overview: { government },
  } as any;
  const council = {
    courtiers: [],
    seats: {
      chancellor: null,
      steward: null,
      marshal: null,
      spymaster: null,
      court_chaplain: null,
    },
  };
  const cache = {
    get: async () => snap,
    memoQuery: async () => ({ data: council }),
    loc: { decodeNames: (s: string) => s },
    lookup: {},
  } as any;
  let handler: any;
  const server = {
    registerTool: (_name: string, _cfg: any, h: any) => {
      handler = h;
    },
  } as any;
  registerCouncilTool(server, cache);
  const res = await handler({});
  return res.content[0].text as string;
}

describe("council tool", () => {
  it("says a merchant has only the spouse seat instead of suggesting the five seats", async () => {
    const text = await runCouncil("merchant_government");
    expect(text).toContain("only the spouse seat exists");
    expect(text).not.toContain("- chancellor:");
    expect(text).not.toContain("suggest");
  });

  it("keeps listing the five seats for other governments", async () => {
    const text = await runCouncil("feudal_government");
    expect(text).toContain("- chancellor:");
    expect(text).toContain("- court_chaplain:");
    expect(text).not.toContain("only the spouse seat exists");
  });
});
