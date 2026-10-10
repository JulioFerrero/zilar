---
id: T-1021
title: "Size split T75: apps/mobile/src/lib/attachment-native.ts (528 lines) into lib/{attachment-picker,attachment-uploader,attachment-opener,gif-downloader}.ts, the old path re-exports"
status: todo
milestone: M5
branch: task/T-1021-split-mobile-attachment-native
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1021: Split `attachment-native.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/lib/attachment-native.ts` is 528 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #71 (task T75): `lib/attachment-picker.ts`, `lib/attachment-uploader.ts`, `lib/attachment-opener.ts`, `lib/gif-downloader.ts`, under `apps/mobile/src/`. `attachment-native.ts` re-exports every name it exports today.

- **Skip the Dedup:** it crosses files to `packages/chat-core` and `voice-native.ts`.
- **Shared code:** the shared `NativeFailure` types, the message constants (`attachment-native.ts:32-56`) and `authHeadersFor` (`attachment-native.ts:508-528`) go into one new `lib/attachment-common.ts`, so the new files don't import the barrel.
- **Move unchanged:** `authHeadersFor` decides which host gets the user's session token, so not one line of it changes.

The lead runs a phone smoke of the composer's attach button in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #71, and `apps/mobile/src/lib/attachment-native.ts`.

### Allowed files
`apps/mobile/src/lib/attachment-native.ts`, `apps/mobile/src/lib/attachment-picker.ts`, `apps/mobile/src/lib/attachment-uploader.ts`, `apps/mobile/src/lib/attachment-opener.ts`, `apps/mobile/src/lib/gif-downloader.ts`, `apps/mobile/src/lib/attachment-common.ts`, `work/T-1021-split-mobile-attachment-native.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
