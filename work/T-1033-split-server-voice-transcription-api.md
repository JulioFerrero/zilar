---
id: T-1033
title: "Size split T110: apps/server/src/voice-transcription/api.ts (422 lines) into voice-transcription/{schemas,middleware}.ts, api.ts keeps deps, limiter, group, handlers and mount"
status: todo
milestone: M5
branch: task/T-1033-split-server-voice-transcription-api
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1033: Split `voice-transcription/api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/voice-transcription/api.ts` is 422 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #106 (task T110): `voice-transcription/schemas.ts` and `voice-transcription/middleware.ts`, under `apps/server/src/`. `api.ts` keeps the deps, the limiter setup, the group, the handlers, the mount and every export it has today. The folder already holds `pipeline.ts`, `provider.ts`, `routes.ts` and `settings.ts`; leave them as they are.

Move the code unchanged, and skip both Dedup items. The two middleware layers decide who may transcribe, which is permissions code: not one line of them changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #106, and `apps/server/src/voice-transcription/api.ts`.

### Allowed files
`apps/server/src/voice-transcription/api.ts`, `apps/server/src/voice-transcription/schemas.ts`, `apps/server/src/voice-transcription/middleware.ts`, `work/T-1033-split-server-voice-transcription-api.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
