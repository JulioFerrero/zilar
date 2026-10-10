---
id: T-1024
title: "Size split T103: apps/server/src/media/indexer.ts (435 lines) into media/{extract,rows}.ts, the old path keeps the types, buildIndexQuery, senderJidFor and indexChat"
status: merged
milestone: M5
branch: task/T-1024-split-server-media-indexer
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1024: Split `media/indexer.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/media/indexer.ts` is 435 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #99 (task T103): `media/extract.ts` and `media/rows.ts`, under `apps/server/src/`. `media/indexer.ts` keeps the types, `buildIndexQuery`, `senderJidFor`, `indexChat` and re-exports of every name it exports today.

Move the code unchanged, and skip the Dedup. The local `MediaItemRow` stays as it is: swapping it for the `db/rows.ts` type is a separate check.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #99, and `apps/server/src/media/indexer.ts`.

### Allowed files
`apps/server/src/media/indexer.ts`, `apps/server/src/media/extract.ts`, `apps/server/src/media/rows.ts`, `work/T-1024-split-server-media-indexer.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/media/indexer.ts` (435 lines) into the two modules the plan
entry names, moving code unchanged and keeping the original path a hybrid barrel,
per `docs/audit/split-rules.md`:

- `media/extract.ts` — the payload/link extraction (old lines 67–218): `AGENT_NAMESPACE`,
  `AGENT_PATTERN`, `unescapeXmlText`, `decodeAgentPayload`, `URL_PATTERN`, `ALWAYS_STRIP`,
  `BRACKETS`, `countCharacter`, `trimTrailingPunctuation`, `authorityOf`, `extractLinks`,
  `extractMediaItems`, `extractMediaItemsUnsafe`.
- `media/rows.ts` — the insert rows (old lines 220–305): `MediaItemRow`, `RowBase`,
  `toInsert`, `insertItems`.
- `media/indexer.ts` — keeps the constants, the types (`MediaKind`, `ExtractedMediaItem`,
  `MediaLink`, `MediaChatScope`, `IndexChatInput`, `IndexChatResult`), `buildIndexQuery`,
  `senderJidFor`, `indexChat`, and re-exports `extractLinks` / `extractMediaItems`.

Per the spec I skipped the Dedup: the local `MediaItemRow`/`RowBase` stay as they are
(no import from `db/rows.ts`). No behaviour change; importers untouched
(`agents/memory/indexer.ts`, `files/api.ts` still import from `../media/indexer`).

### Files changed

- `apps/server/src/media/indexer.ts` (kept, now a barrel)
- `apps/server/src/media/extract.ts` (new)
- `apps/server/src/media/rows.ts` (new)
- `work/T-1024-split-server-media-indexer.md` (this file)

### `wc -l`

```
435  apps/server/src/media/indexer.ts   (old, at main)
197  apps/server/src/media/indexer.ts   (new)
157  apps/server/src/media/extract.ts
 93  apps/server/src/media/rows.ts
```

All three stay well under 400 lines.

### Export list before and after

`grep -E "^export"` on the old file vs the barrel plus the new files.

Before (12 exports):

```
export const MEDIA_INDEX_MAX_ROWS = 5000;
export const MEDIA_ITEMS_CAP_PER_CHAT = 20000;
export type MediaKind = 'image' | 'file' | 'gif' | 'voice' | 'link';
export interface ExtractedMediaItem {
export interface MediaLink {
export type MediaChatScope = { kind: 'dm'; peer: string } | { kind: 'room'; room: string };
export interface IndexChatInput {
export interface IndexChatResult {
export function extractLinks(text: string): MediaLink[] {
export function extractMediaItems(row: ArchiveRow): ExtractedMediaItem[] {
export function buildIndexQuery(input: {
export async function indexChat(input: IndexChatInput): Promise<IndexChatResult> {
```

After — `media/indexer.ts`:

```
export { extractLinks, extractMediaItems };
export const MEDIA_INDEX_MAX_ROWS = 5000;
export const MEDIA_ITEMS_CAP_PER_CHAT = 20000;
export type MediaKind = 'image' | 'file' | 'gif' | 'voice' | 'link';
export interface ExtractedMediaItem {
export interface MediaLink {
export type MediaChatScope = { kind: 'dm'; peer: string } | { kind: 'room'; room: string };
export interface IndexChatInput {
export interface IndexChatResult {
export function buildIndexQuery(input: {
export async function indexChat(input: IndexChatInput): Promise<IndexChatResult> {
```

`media/extract.ts`:

```
export function extractLinks(text: string): MediaLink[] {
export function extractMediaItems(row: ArchiveRow): ExtractedMediaItem[] {
```

`media/rows.ts`:

```
export { insertItems, toInsert };
```

Diff: the barrel still exports every one of the 12 previous names, with the same
kinds; `extractLinks`/`extractMediaItems` now come from `extract.ts` and are
re-exported. `rows.ts` additionally exports its two internal helpers
(`insertItems`, `toInsert`) so the barrel can import them — they are not part of
the old public surface and are not re-exported by `indexer.ts`.

### Effect ratchet

`extract.ts` is a new file with only a weak signal (`W4`, the `try`/`catch` in the
moved extraction code) and no value `effect` import, so it would classify
`needs-effect`; it carries the marker
`// effect-plain: moved unchanged from apps/server/src/media/indexer.ts (size split)`
on line 1, listed here as required. `rows.ts` imports `effect` as a value, so it
classifies `effect` and needs no marker. The gate's `PASS effect` confirms both.

### Commands I ran

- `pnpm install` — done (lockfile unchanged).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/files/routes.test.ts`
  — 1 file, 13 tests passed (the closest runtime test; `files/api.ts` imports
  `indexChat` from the barrel). `apps/server/src/media/` holds no test files.
- `pnpm gate` — see below.

### Gate summary

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (2.9s)
PASS  format  (1.8s)
PASS  lint  (1.3s)
PASS  typecheck  (6.1s)
PASS  effect  (2.1s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Problems, deviations, open questions

- Deviation from the plan entry (per the spec): the `MediaItemRow`/`RowBase` dedup
  against `db/rows.ts` was intentionally skipped; the local types stay.
- No other deviations, no blocked items.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `media/indexer.ts` (435 lines) is now 197 lines, plus `extract` (157) and `rows` (93).
- **The lead's line check:** the old file's non-import code lines against the new files'. They are identical in both directions.
- **Check:** the gate passed.
