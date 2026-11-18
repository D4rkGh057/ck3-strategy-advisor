# CLAUDE.md

Local stdio **MCP server**: reads the player's latest **Crusader Kings III** save and exposes it as read-only tools (registry: `src/tools/index.ts`). Install and usage: `README.md`.

## Hard rules

- NEVER modify the save or the game. The only write is the timeline in `src/history.ts` (`~/.ck3-advisor/history`, override with `CK3_HISTORY_DIR`).
- NEVER invent data the save does not store: per-character men-at-arms, strong/weak claims, computed opinion totals. Tool descriptions state these limits; keep them honest.
- NEVER throw to the MCP client. On a missing/Ironman/unreadable save, `cache.get()` returns `{ error }`; return `{ isError: true, content: [{ type: "text", text: error }] }`.
- NEVER index arrays via JSON pointer (`/skill/0` returns `undefined`). Fetch the array with `q.at(parent)` and iterate in JS.
- ALWAYS verify a new `q.at(...)` path resolves through jomini, not just in raw text.
- ALWAYS use explicit `.js` extensions in relative imports (ESM + NodeNext) and `import type` for type-only imports.

## Commands

```bash
npm run build         # tsc -> dist/ (MCP entry is dist/index.js); also the type gate
npm run dev           # run from source via tsx
npm test              # vitest, whole suite
npx vitest run tests/military.test.ts   # single file
npm run lint          # eslint; npm run format:check for prettier
```

## Data flow (save file -> markdown)

`source.ts` (newest parseable text `.ck3`; skips binary and Ironman) -> `envelope.ts` (PKZIP -> gamestate; Ironman = plaintext `meta_data={` marker, throws `IronmanError`) -> `parser.ts` (lazy jomini WASM, `Query.at(pointer)`) -> `snapshot.ts` (one parse feeds every extractor) -> `cache.ts` (keyed `path:mtimeMs`, coalesces builds, keeps last good snapshot on a mid-write failure, `query()` for a fresh pass) -> `extract/*.ts` (pure `(q, loc, ...) => Info`, no I/O, no MCP; save-field knowledge lives here) -> `tools/*.ts`.

Tools are built on `tools/kit.ts` (`loadQuery`, `run`, `stamped`, `errorResult`); use `stamp` and `truncate` from `format.ts` in every new tool. `localization.ts` loads English `.yml` from `CK3_GAME_DIR` (else the Steam install found by `discoverGameDir` in `config.ts`) and falls back to raw keys.

## Module rules

- Show skills via `extract/skills.ts` (`effectiveSkills`: base + trait bonuses), never the raw `skill` array.
- `gameLookup.ts` (`game_search`, `game_entry`) indexes the game's own script files via `gameScript.ts`. It never reads the save, so those tools are NOT stamped.
- `extract/marriage.ts` reuses `Kin`/`buildParentIndex` from `extract/family.ts`; compute skills only for the shortlist (slow part).

## Save fields

`docs/save-schema.md` is the canonical, jomini-verified reference. Read it BEFORE touching any `q.at(...)`.

- Title data: `/landed_titles/landed_titles/{id}` (doubly nested). Factions: `/faction_manager/factions`.
- Player-relative: `pid = /played_character/character`, then `/living/{pid}/...`.
- `alive_data/*` (gold, prestige, claims) vs `landed_data/*` (domain, levy, council, laws, succession). Some raw-text fields do NOT resolve through jomini; the schema marks the working path.

```bash
node scripts/inspect-section.mjs <save.ck3|gamestate.txt> <needle> [bytes] [occurrence]
node scripts/check-paths.mjs   <save.ck3|gamestate.txt> '/living/{player}/...' [more ptrs]
```

## If you change X, also change Y

- `q.at` path or save gotcha -> `docs/save-schema.md` (same change)
- New extractor -> `tests/<area>.test.ts`; extend `tests/fixtures/mini-gamestate.txt` if needed
- New tool -> register in `tools/index.ts`; `stamp` + `truncate`; state data limits in the description

Tests: vitest, one `tests/<area>.test.ts` per extractor/tool; fixtures in `tests/fixtures/` (`make-envelope.ts` builds a fake `.ck3`).
