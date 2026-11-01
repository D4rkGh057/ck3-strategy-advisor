import { describe, expect, test } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerAllPrompts } from "../src/prompts/index.js";
import { turnReviewText } from "../src/prompts/turnReview.js";

async function connect() {
  const server = new McpServer({ name: "t", version: "0" });
  registerAllPrompts(server);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "c", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("ck3-turn-review prompt", () => {
  test("is listed with an optional focus argument", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    const p = prompts.find((x) => x.name === "ck3-turn-review");
    expect(p).toBeDefined();
    expect(p?.arguments?.find((x) => x.name === "focus")?.required).toBeFalsy();
  });

  test("get returns one user message naming the batch tools and the honesty limits", async () => {
    const client = await connect();
    const res = await client.getPrompt({ name: "ck3-turn-review", arguments: {} });
    expect(res.messages).toHaveLength(1);
    const text = (res.messages[0].content as { text: string }).text;
    for (const t of ["realm_overview", "alerts", "succession", "factions", "military", "history"])
      expect(text).toContain(`\`${t}\``);
    expect(text).toContain("does NOT store");
    expect(text).not.toContain("Extra focus");
  });

  test("warns that monthly income is gross, not net", () => {
    expect(turnReviewText()).toContain("GROSS");
  });

  test("focus is injected only when given", () => {
    expect(turnReviewText("my heir")).toContain('"my heir"');
    expect(turnReviewText("   ")).not.toContain("Extra focus");
  });
});
