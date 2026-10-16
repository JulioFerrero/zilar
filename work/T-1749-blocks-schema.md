---
id: T-1749
title: "Message blocks B1: the `blocks` payload schema in @zilar/protocol, all 25 kinds from the approved boards, split by group, plus one union member and two pipeline tests"
status: merged
milestone: M5
branch: task/T-1749-blocks-schema
model: auto
effort: default
depends_on: [T-1747]
estimate: 45 min
---

# T-1749: The blocks schema (plan task B1)

## Spec (written by Claude, do not edit)

### Why
This is task B1 of `docs/plan/message-blocks.md` (§1, §6 Wave 1). Julio approved 25 native message blocks on 2026-10-16. The boards and the shared look are in `docs/design/mockups/blocks/`. Every later block task builds on this schema.

### Facts (the lead read them on 2026-10-16)
- **`packages/protocol/src/payload.ts` (129 lines):**
  - imports one schema per kind (`:1-14`) and caps the whole payload with `MAX_PAYLOAD_BYTES = 64 * 1024` (`:16`);
  - `PayloadSchema` is a `Schema.Union([...])` of `Schema.Struct({ v: Schema.Literal(0), type: Schema.Literal('…'), data: … })` members (`:18-56`);
  - `KNOWN_PAYLOAD_TYPES` derives itself from the members (`:60-62`), so a new member needs nothing else there.
- **`packages/protocol/src/common.ts` (154 lines):**
  - `struct` (`:15-23`);
  - `IdSchema`, 1–128 characters of `[A-Za-z0-9._~-]` (`:66-72`);
  - a private `HttpUrlSchema` that accepts http and https (`:144-149`, `isHttpUrl` `:120-135`).
- **The pattern to copy:** `packages/protocol/src/poll.ts` (41 lines) caps fields with `Schema.check` and uses a `Schema.makeFilter` for unique ids.
- **The export barrel** is `packages/protocol/src/index.ts` (18 lines); `payload.test.ts` holds 15 tests (350 lines).

### Steps
1. **`packages/protocol/src/blocks.ts`:** the shared pieces from the plan §1:
   - the caps `MAX_BLOCKS = 12`, `MAX_BLOCK_BYTES = 16 * 1024`, `MAX_TEXT = 120`, `MAX_SHORT = 40`, `MAX_ROWS = 24`, `MAX_SERIES = 30`;
   - the `Text`, `ShortText` and `NumberText` string schemas;
   - `ChangeSchema`, `BlockIconSchema` (the plan's 24 names), and an https-only `HttpsUrlSchema` (at most 2048 characters, `new URL` parse, protocol `https:`);
   - `BlockSchema`, the union of every kind, imported from the four group files below;
   - `BlocksDataSchema`: `title?`, `icon?`, `meta?`, `fallback` (1–1000 characters), and `blocks` (1–`MAX_BLOCKS`) with a `makeFilter` that rejects `JSON.stringify(blocks)` longer than `MAX_BLOCK_BYTES`;
   - the exported types (`Block`, `BlocksData`, one type per kind).
2. **Four group files, one schema per kind, each with a `kind` literal.** Use exactly the fields of the plan's "Six kinds in full" and "The other 19 kinds" table, with these changes:
   - **`packages/protocol/src/blocks-numbers.ts`:** 01 `figure`, 02 `number`, 03 `stats`, 04 `table`, 05 `bars`, 06 `line`, 07 `gauge`. Every ratio is a number from 0 to 1, and every chart value is a finite number.
   - **`packages/protocol/src/blocks-progress.ts`:** 08 `checklist`, 09 `progress`, 10 `timeline`, 11 `countdown`, 12 `status`.
     - `countdown.targetAt` is an ISO date-time string that `Date.parse` accepts.
   - **`packages/protocol/src/blocks-choices.ts`:** 13 `buttons`, 14 `poll` (call its schema `PollBlockSchema`; it doesn't touch the existing `poll.ts`), 15 `choice`, 16 `form`, 17 `rating`, 18 `alert`.
     - Every interactive kind has an `id: IdSchema`, and its option, item, field and action ids are `IdSchema` and unique, through `makeFilter`.
   - **`packages/protocol/src/blocks-content.ts`:** 19 `link`, 20 `images`, 21 `place`, 22 `weather`, 23 `event`, 24 `file`, 25 `callout`.
     - `link.url` and `place.url?` use `HttpsUrlSchema`; `place.url` replaces `directionsUrl`.
     - `place.map?` is an optional uploaded-media `IdSchema`, because there's no map service.
     - Media ids are `IdSchema`, never URLs.
3. **In `payload.ts`:** import `BlocksDataSchema` and add one member, `Schema.Struct({ v: Schema.Literal(0), type: Schema.Literal('blocks'), data: BlocksDataSchema })`, at the end of the union. Don't reorder the others.
4. **In `index.ts`:** add `export * from './blocks';`. Re-export the group files from `blocks.ts`, or add four export lines.
5. **Two tests in `payload.test.ts`:**
   - (a) a `blocks` payload with one each of `figure`, `checklist`, `link` and `callout` decodes through `decodePayload`;
   - (b) one call each rejects 13 blocks, an unknown icon, and an `http:` link.
6. **Every file stays under 400 lines.** No other package changes.

### Allowed files
- `packages/protocol/src/blocks.ts`
- `packages/protocol/src/blocks-numbers.ts`
- `packages/protocol/src/blocks-progress.ts`
- `packages/protocol/src/blocks-choices.ts`
- `packages/protocol/src/blocks-content.ts`
- `packages/protocol/src/payload.ts`
- `packages/protocol/src/index.ts`
- `packages/protocol/src/payload.test.ts`
- `work/T-1749-blocks-schema.md`

### Checks
```bash
pnpm --filter @zilar/protocol exec vitest run src/payload.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **All 25 kinds decode** through `decodePayload` as `type: 'blocks'`.
- **The caps hold:** 12 blocks, 16 KiB of blocks, https only, the fixed icons.
- **The two new tests pass, and the gate passes.**

---

## Report (written by the worker when done)

### What I did
- New `packages/protocol/src/blocks.ts`: `BlockSchema` (a `Schema.Union` of all 25 kind
  schemas, board order 01–25), `BlocksDataSchema` (`title?`, `icon?`, `meta?`, required
  `fallback` 1–1000, `blocks` 1–`MAX_BLOCKS` with a `JSON.stringify` filter over
  `MAX_BLOCK_BYTES`), and the `Block` / `BlocksData` types. It re-exports the four groups.
- New group files, one schema + type per kind, each with a `kind` literal:
  - `blocks-numbers.ts`: 01 `figure`, 02 `number`, 03 `stats`, 04 `table`, 05 `bars`, 06 `line`,
    07 `gauge`; every ratio is 0–1 (`RatioSchema`) and every chart value is finite
    (`FiniteNumberSchema`).
  - `blocks-progress.ts`: 08 `checklist`, 09 `progress`, 10 `timeline`, 11 `countdown`,
    12 `status`; `countdown.targetAt` is an ISO date-time that `Date.parse` accepts.
  - `blocks-choices.ts`: 13 `buttons`, 14 `poll` (`PollBlockSchema`; `poll.ts` untouched),
    15 `choice`, 16 `form`, 17 `rating`, 18 `alert`; every interactive kind has `id: IdSchema`,
    and button-action / poll-option / form-field / checklist-item ids are `IdSchema` and unique
    through `makeFilter`.
  - `blocks-content.ts`: 19 `link`, 20 `images`, 21 `place`, 22 `weather`, 23 `event`, 24 `file`,
    25 `callout`; `link.url` and `place.url` use the https-only `HttpsUrlSchema`; `place.map`
    (optional) and all media use `IdSchema`, never a URL.
- `payload.ts`: imported `BlocksDataSchema` and added one member at the end of the union —
  `Schema.Struct({ v: Literal(0), type: Literal('blocks'), data: BlocksDataSchema })`; the other
  members are untouched.
- `index.ts`: added `export * from './blocks';`.
- `payload.test.ts`: added the two spec'd tests (one `blocks` payload with `figure`, `checklist`,
  `link`, `callout`; and one call each rejecting 13 blocks, an unknown icon and an `http:` link).

### Checks run
- `pnpm --filter @zilar/protocol test --maxWorkers=2 --reporter=dot src/payload.test.ts` →
  **17 passed (17)**, 1 file. (15 pre-existing + the 2 new.)
- Temporary scratch test (one valid block of each of the 25 kinds, `decodePayload` per kind) →
  **1 passed**, then deleted (not committed). This is how I verified the "all 25 kinds decode"
  acceptance, since `MAX_BLOCKS = 12` rules out all 25 in one payload.
- `pnpm gate` (from the repo root) → **GATE PASS**, 9 changed files against `main`:
  `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`,
  `PASS tests @zilar/protocol`; `scope: every changed file is inside the Allowed files`;
  `migration`/`images`/`size` all pass.
- Files changed (all in Allowed files): `blocks.ts`, `blocks-numbers.ts`, `blocks-progress.ts`,
  `blocks-choices.ts`, `blocks-content.ts`, `payload.ts`, `index.ts`, `payload.test.ts`,
  `work/T-1749-blocks-schema.md`. Every source file is well under 400 lines.

### Notes for the lead
- **Deviation 1 (structure).** The spec puts the shared pieces (caps, `Text`/`ShortText`/
  `NumberText`, `ChangeSchema`, `BlockIconSchema`, `HttpsUrlSchema`) in `blocks.ts` while the
  group files import them and `blocks.ts` imports the groups. That is a static ESM cycle: the
  groups run before `blocks.ts`'s body, so reading a helper there throws `Cannot access '…'
  before initialization` (I reproduced this with a two-file ESM test). The Allowed files have no
  separate shared module, so the shared pieces live in the first group, `blocks-numbers.ts`, and
  `blocks.ts` re-exports them (`export * from './blocks-numbers'`). The public surface is
  unchanged: `HttpsUrlSchema`, `ChangeSchema`, `BlockIconSchema`, the caps, `BlockSchema` and
  `BlocksDataSchema` all import from `@zilar/protocol` / `./blocks` as the spec expects.
- **Deviation 2 (`file`).** The plan's row 24 gives the file block a `kind` field (its format,
  the board reads "12 KB · CSV · 31 rows"), but `kind` is every block's discriminator, so a struct
  cannot carry both. I named the format `format`: `{ media, name, size, format, rows? }`.
- `choice` keeps its plan shape (options as `Text`, plus a block `id`); it has no option ids, so
  there is nothing to make unique. `selected`/`rating.max`/`votes`/`images.extra` are non-negative
  integers.
- Test (a) covers only the four kinds the spec names; the union statically contains all 25 and
  the scratch run above decoded them all. I did not add a third test (plan §6 caps this task at
  two).
- Per the security checklist: this is a protocol-schema-only change — no route, DB write, secret
  or log touched. All caps (12 blocks, 16 KiB, 1–1000 fallback, https-only links, fixed icons)
  are enforced in the schema, and every text field is a plain string (no HTML/markup).
- I did **not** run format/lint/typecheck/whole suites one by one; only the single focused test
  file, the gate once, and the throwaway scratch test above.

### Round 1 (fix round after PREREVIEW.md)

- **F1 (should-fix) — fixed.** `payload.test.ts` was 436 lines, over the spec step 6 cap
  ("Every file stays under 400 lines"). I compacted the two T-1749 block tests — the same
  four-kind decode round-trip (`figure`, `checklist`, `link`, `callout`) and the same three
  rejects (13 blocks, an unknown icon, an `http:` link) — into hoisted literals and a shared
  `envelope` helper, so the file is now **396 lines** (prettier reports it unchanged).
  No test and no assertion was dropped or weakened.
- **F2, F3 (nits) — untouched**, as instructed: neither line was otherwise changed.
- **Disagreements:** none — every PREREVIEW finding was accepted as written.
- **Tests.** `pnpm --filter @zilar/protocol test --maxWorkers=2 --reporter=dot src/payload.test.ts`
  → **1 file, 17 passed (17)**.
- **Gate.** `pnpm gate` (repo root) → **GATE PASS**:
  `gate: 9 changed file(s) against main`, `PASS install (frozen)`, `PASS format`, `PASS lint`,
  `PASS typecheck`, `PASS effect`, `PASS tests @zilar/protocol`,
  `scope: every changed file is inside the Allowed files`,
  `size: every changed source file is within 400 lines`, `migration` and `images` pass.
- Changed in this round: `packages/protocol/src/payload.test.ts` and this Report only.

### Round 2 (fix round after the next PREREVIEW.md, HEAD 287daa9)

- **F1 (should-fix) — fixed.** The `http:` reject fixture in `payload.test.ts` was
  `{ fallback: 'x', blocks: [{ kind: 'link', url: 'http://example.com' }] }`. But
  `LinkBlockSchema` requires `title`, so that fixture failed on the missing field, not on the
  scheme: the decode asserted `false` even if `HttpsUrlSchema` regressed to accept `http:`.
  I added `title: 'x'` so the block is otherwise complete and the only reason left to fail is
  the `http:` scheme, which is what the "https only" acceptance point needs. The fixture is
  wrapped over four lines; no other change and no assertion weakened.
- **Disagreements:** none — the finding was accepted as written.
- **Tests.** `pnpm --filter @zilar/protocol test --maxWorkers=2 --reporter=dot src/payload.test.ts`
  → **1 file, 17 passed (17)**.
- **Gate.** `pnpm gate` (repo root) → **GATE PASS**:
  `gate: 9 changed file(s) against main`, `PASS install (frozen)`, `PASS format`, `PASS lint`,
  `PASS typecheck`, `PASS effect`, `PASS tests @zilar/protocol`,
  `scope: every changed file is inside the Allowed files`,
  `size: every changed source file is within 400 lines`, `migration` and `images` pass.
- `payload.test.ts` is now **399 lines** (was 396), still under the 400-line cap and
  prettier-clean.
- Changed in this round: `packages/protocol/src/payload.test.ts` and this Report only.
