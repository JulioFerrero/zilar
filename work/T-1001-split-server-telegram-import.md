---
id: T-1001
title: "Size split T59: apps/server/src/stickers/telegram-import.ts (573 lines) into stickers/telegram/{pack-input,errors,set,transport,client}.ts, the old path a barrel"
status: todo
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

## Review (written by Claude)
