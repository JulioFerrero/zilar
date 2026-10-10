---
id: T-1001
title: "Size split T59: apps/server/src/stickers/telegram-import.ts (573 lines) into stickers/telegram/{pack-input,errors,set,transport,client}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-1001-split-server-telegram-import
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1001: Split `stickers/telegram-import.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/stickers/telegram-import.ts` is 573 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #55 (task T59). The new files go in a new `apps/server/src/stickers/telegram/` folder:
- `pack-input.ts`, `errors.ts`, `set.ts`;
- `transport.ts`, `client.ts`.

`stickers/telegram-import.ts` becomes the barrel. The file `stickers/telegram.ts` already exists; leave it as it is.

- **Move unchanged:** move the code as it is, and skip both Dedup items, because both cross files.
- **The token scrub:** `scrubTokenText` keeps the bot token out of every error and log. It must move unchanged, and every path that uses it today must still use it.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #55, and `apps/server/src/stickers/telegram-import.ts`.

### Allowed files
`apps/server/src/stickers/telegram-import.ts`, `apps/server/src/stickers/telegram/pack-input.ts`, `apps/server/src/stickers/telegram/errors.ts`, `apps/server/src/stickers/telegram/set.ts`, `apps/server/src/stickers/telegram/transport.ts`, `apps/server/src/stickers/telegram/client.ts`, `work/T-1001-split-server-telegram-import.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for, plus the list of the `scrubTokenText` call sites before and after.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/stickers/telegram-import.ts` (573 lines) into
`apps/server/src/stickers/telegram/{pack-input,errors,set,transport,client}.ts`,
with `telegram-import.ts` left as a thin barrel. Code moved unchanged; the
only edits are the import lines each file now needs and the export keyword on
the internals that a sibling file uses. The two **Dedup** items in the plan
entry (`scrubTokenText` → shared secret scrub, `readDownloadBody`/`readEnvelopeBody`
→ one capped-read helper shared with stickers `readCapped`) were **skipped**:
both cross files, so per `split-rules.md` item 2 they are a separate F task.

### `wc -l` (old and new)

| File | Lines |
| --- | ---: |
| `stickers/telegram-import.ts` (old) | 573 |
| `stickers/telegram-import.ts` (barrel, new) | 40 |
| `stickers/telegram/errors.ts` | 82 |
| `stickers/telegram/pack-input.ts` | 49 |
| `stickers/telegram/set.ts` | 74 |
| `stickers/telegram/transport.ts` | 269 |
| `stickers/telegram/client.ts` | 115 |

Every file is under the 400-line limit.

### Export list before → after

Before (`grep -E "^export"`, old file) — 11 names:
`TELEGRAM_API_HOST`, `TELEGRAM_IMPORT_TIMEOUT_MS`, `TELEGRAM_IMPORT_MAX_BYTES`,
`TELEGRAM_JSON_MAX_BYTES`, `TelegramImportErrorCode` (type), `TelegramImportError`
(value), `parseTelegramPackInput` (value), `TelegramStickerEntry` (type),
`TelegramStickerSet` (type), `TelegramClient` (type), `createTelegramClient` (value).

After, the barrel re-exports the same 11 names with the same kinds:

```ts
export { TELEGRAM_API_HOST, TELEGRAM_IMPORT_MAX_BYTES, TELEGRAM_IMPORT_TIMEOUT_MS,
  TELEGRAM_JSON_MAX_BYTES, TelegramImportError, type TelegramImportErrorCode } from './telegram/errors';
export { parseTelegramPackInput } from './telegram/pack-input';
export type { TelegramClient, TelegramStickerEntry, TelegramStickerSet } from './telegram/set';
export { createTelegramClient } from './telegram/client';
```

The internal modules export extra names the barrel does **not** re-export
(the six `Telegram*` tagged errors, `TelegramFailure`, `UNREACHABLE_MESSAGE`,
`failureToImportError`, `scrubTokenText` in `errors.ts`; `TelegramApiEnvelope`,
`toStickerSet` in `set.ts`; `ApiCallOptions`, `FetchFn`, `botFileUrl`,
`fetchCappedEffect`, `callMethodEffect` in `transport.ts`), because the moved
code refers to them across the new files. The public surface of
`telegram-import.ts` is unchanged, so no importer changed. Confirmed with
`grep -rn "telegram-import"`: five importers (`stickers/telegram.ts`,
`stickers/api-handlers.ts`, `stickers/routes.ts`, `integrations/api.ts`,
`integrations/routes.ts`, plus `app.ts`) all import only the 11 public names.

### `scrubTokenText` call sites, before and after

Before (old file):
- line 12 — header comment;
- line 199 — definition;
- line 496 — `scrubTokenText(token, info.message)` in `toImportError`;
- line 524 — `scrubTokenText(token, UNREACHABLE_MESSAGE)` in the `catchCause` fallback.

After:
- `telegram-import.ts:12` — same header comment;
- `telegram/errors.ts:77` — definition (moved unchanged);
- `telegram/client.ts:33` — `scrubTokenText(token, info.message)` (same call);
- `telegram/client.ts:61` — `scrubTokenText(token, UNREACHABLE_MESSAGE)` (same call).

Same definition, same two call sites, same arguments. No path that used the
scrub stopped using it.

### Commands run

- `pnpm install` — done, no lockfile change (`git status` clean apart from the task's own files).
- `pnpm exec prettier --write` on the six touched files (targeted, not the repo) — only `telegram-import.ts` and `client.ts` were reflowed.
- `pnpm gate` (from repo root) — summary:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.8s)
  PASS  effect  (1.9s)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

I ran no single-file tests: `grep` across `apps/server` finds no test that
imports `telegram-import` or mentions Telegram, so the gate reported "no nearby
test files" for `@zilar/server`.

### Deviations and notes

- The plan's line ranges overlap (`errors.ts` 129–204 vs `transport.ts` 176–197)
  and skip 122–127. I put `botMethodUrl`/`botFileUrl`/`assertTelegramUrl`
  (176–197) in `transport.ts`, which the plan's own transport range names; and
  `ApiCallOptions`/`FetchFn` (122–125, 127), which the plan does not list and
  which only the transport uses, also in `transport.ts`.
- `TelegramApiEnvelope` (206–212) went to `set.ts` per its range and is
  imported by `transport.ts`; `set.ts` does not import transport, so there is
  no cycle.
- `pack-input.ts` carries `// effect-plain: moved unchanged from apps/server/src/stickers/telegram-import.ts (size split)`
  because the moved `decodeURIComponentSafe` has a `try`/`catch` (signal W4) but
  the file imports no Effect. `errors.ts`, `transport.ts` and `client.ts` import
  Effect values, so they classify as `effect` and needed no marker.
- No behaviour change: the moved bodies are byte-identical apart from the
  `export` keyword on cross-file internals.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `stickers/telegram-import.ts` (573 lines) becomes the barrel plus `stickers/telegram/{pack-input,errors,set,transport,client}`, the largest `transport.ts` at 269.
- **The token scrub, checked by the lead:** `scrubTokenText(` appears 3 times on main and 3 times on the branch: the definition (`telegram/errors.ts:77`) and both error paths (`telegram/client.ts:33,61`).
- **Check:** the gate passed.
