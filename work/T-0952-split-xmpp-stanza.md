---
id: T-0952
title: "Size split T17: packages/xmpp-core/src/stanza.ts (1,078 lines) into stanza/{reactions,build-outgoing,parse-context,parse-presence,parse-roster,resolve-sender,parse-fields,decode}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0952-split-xmpp-stanza
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0952: Split `stanza.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `packages/xmpp-core/src/stanza.ts` is 1,078 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #13 (task T17 in §4.2): `stanza/reactions.ts`, `stanza/build-outgoing.ts`, `stanza/parse-context.ts`, `stanza/parse-presence.ts`, `stanza/parse-roster.ts`, `stanza/resolve-sender.ts`, `stanza/parse-fields.ts`, `stanza/decode.ts`, under `packages/xmpp-core/src/`. `stanza.ts` becomes the barrel.

T-0951 splits `core-effect.ts` in the same package at the same time. Touch neither it nor `core-effect/`.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #13, and `packages/xmpp-core/src/stanza.ts`.

### Allowed files
`packages/xmpp-core/src/stanza.ts`, `packages/xmpp-core/src/stanza/reactions.ts`, `packages/xmpp-core/src/stanza/build-outgoing.ts`, `packages/xmpp-core/src/stanza/parse-context.ts`, `packages/xmpp-core/src/stanza/parse-presence.ts`, `packages/xmpp-core/src/stanza/parse-roster.ts`, `packages/xmpp-core/src/stanza/resolve-sender.ts`, `packages/xmpp-core/src/stanza/parse-fields.ts`, `packages/xmpp-core/src/stanza/decode.ts`, `work/T-0952-split-xmpp-stanza.md`.

### Checks
```bash
pnpm --filter @zilar/xmpp-core exec vitest run --reporter=dot src/stanza.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
