# Changelog

## 0.2.0

This fork continues the project after upstream development stopped at v0.1.2
(2026-06-24). It keeps the original MIT license and copyright.

### Added

- Tools: `alerts`, `court`, `court_candidates`, `family`, `domain`, `intrigue`,
  `council`, `faith`, `guardians`, `expansion_targets`, `marriage_candidates`,
  `prisoners`, `raids`, `trade`, `trade_suggestions`, `history`, `game_search`
  and `game_entry`; `foreign_realm` now lists tributaries.
- Playthrough timeline (`history`), stored under `~/.ck3-advisor/history`.
- MCP prompts: `ck3-turn-review` and a succession plan.
- Support for CK3 1.20 saves; trait skill modifiers so skills match the game.
- `realm_overview` shows `gold_expenses` when the save stores it.

### Fixed

- `trade_suggestions` no longer proposes routes beyond your route length: the
  limit is the longest route you run (base 10 province hops if none), not the
  hops of other owners' routes. It is an estimate; the real limit is not in the
  save.
- Succession shows the designated heir; vassal contracts, income (gross),
  guardian and marriage candidate rules, council on merchant governments,
  save discovery on Windows/OneDrive and concurrent history writes.

### Changed

- Faster extraction: per-save memoization, lazy name resolution and shared
  parent indexes.
- Dependencies updated (`@modelcontextprotocol/sdk` 1.32, `zod` 4, `adm-zip` 0.6).
- Repository, issues and CI badge now point to this fork.

Thanks to hunglc007 for the CK3 1.20 support and the marriage, court and
council work.
