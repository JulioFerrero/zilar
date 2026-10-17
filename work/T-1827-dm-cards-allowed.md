---
id: T-1827
title: "DM interactive cards, last step: post_blocks stops refusing interactive kinds in the owner's DM and the guide drops 'never in a direct chat', now that a DM card is recorded, owner-answerable and corrected as chat (T-1824, T-1825)"
status: merged
milestone: M5
branch: task/T-1827-dm-cards-allowed
model: auto
effort: default
depends_on: [T-1824, T-1825]
estimate: 15 min
---

# T-1827: Interactive cards in a DM

## Spec (written by Claude, do not edit)

### Why
The last step of `docs/plan/dm-interactive-cards.md` (see the lead's Review in `work/T-1809-dm-interactive-cards-plan.md`). T-1824 records DM cards, lets only the AI's owner answer them and corrects them as `chat`. T-1825 makes the clients send the origin id and a plain reply in a DM. T-1803's refusal is now what stops it working.

### Facts (read by the lead on 2026-10-17, after T-1824 and T-1825 merged)
- **`apps/server/src/agents/gateway/post-blocks.ts`:**
  - the constant `INTERACTIVE_IN_DM_TEXT`, with its T-1803 comment, at `:42-45`;
  - the guard at `:119-131`: `kind === 'chat' && payload.data.blocks.some((block) => INTERACTIVE_KINDS.includes(block.kind))` returns that text;
  - the `INTERACTIVE_KINDS` import at `:9`.
- **`apps/server/src/agents/gateway/post-blocks.test.ts:190-221`:** `'refuses an interactive card in the owner DM and sends nothing'`.
- **`apps/server/src/message-blocks/guide.ts:118`:** the `INTERACTIVE_RULES` line `'Interactive kinds work only in a group or topic, never in a direct chat.'`.
  - `INTERACTIVE_KINDS` (`:35`) is also used by `guide.test.ts`, so keep the export.

### Steps
1. **`post-blocks.ts`:**
   - Remove the guard, the `INTERACTIVE_IN_DM_TEXT` constant and its comment.
   - Remove the `INTERACTIVE_KINDS` import if nothing else in the file uses it.
2. **`post-blocks.test.ts`:** replace the refusal test with "posts an interactive card in the owner DM and records it". The same poll is sent once as `kind: 'chat'` to the DM JID, and recorded once with no group or topic.
3. **`guide.ts`:** in `INTERACTIVE_RULES`, replace the line with exactly: `In a direct chat only the owner can answer an interactive card.`
4. **No other changes.**

### Allowed files
- `apps/server/src/agents/gateway/post-blocks.ts`
- `apps/server/src/agents/gateway/post-blocks.test.ts`
- `apps/server/src/message-blocks/guide.ts`
- `apps/runner/tsconfig.json` (lead round 2: the include fix for the runner typecheck)
- `work/T-1827-dm-cards-allowed.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/agents/gateway/post-blocks.test.ts src/message-blocks/guide.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- An interactive card in the owner's DM is posted and recorded.
- The guide no longer forbids DMs.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/agents/gateway/post-blocks.ts`: removed the T-1803 interactive-in-DM guard, the `INTERACTIVE_IN_DM_TEXT` constant and its comment; dropped the now-unused `INTERACTIVE_KINDS` import. The `kind` local stays because the tool reply still differs between a group and a DM.
- `apps/server/src/agents/gateway/post-blocks.test.ts`: replaced `'refuses an interactive card in the owner DM and sends nothing'` with `'posts an interactive card in the owner DM and records it'`. The same poll is now sent once as `kind: 'chat'` to the DM JID and recorded once with no group or topic.
- `apps/server/src/message-blocks/guide.ts`: `INTERACTIVE_RULES` line now reads exactly `In a direct chat only the owner can answer an interactive card.`

Files changed: the three files above plus this task file.

### Checks run
```text
cd apps/server && pnpm exec vitest run src/agents/gateway/post-blocks.test.ts src/message-blocks/guide.test.ts --reporter=dot
  2 test files passed, 9 tests passed

pnpm gate (repo root, base main)
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (1.4s)
  PASS  lint  (1.3s)
  PASS  typecheck  (4.2s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/server  (3.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
```

### Notes for the lead
- No deviations from the spec. The `INTERACTIVE_KINDS` export in `guide.ts` is untouched.
- The gate was run once at the end; the only change after it is this Report text inside the task file, which the gate's format check had already covered as an allowed file.
- No security-relevant code was touched (no routes, secrets, queries or permissions).

### Lead fix round: `@zilar/runner` typecheck after the rebase

I did not change any source file. The runner typecheck still fails on a cold Turbo cache; the
gate on my branch only passed because its `typecheck` step was served from Turbo's cache.

What I tried:
1. `pnpm install --frozen-lockfile` in this worktree: "Packages: +1" restored, install finished in 896ms.
2. `pnpm gate` (repo root): `GATE PASS`, all steps `PASS` including `typecheck (0.8s)`.
   That time is a cache hit; `turbo run typecheck --filter=@zilar/runner --dry=json` reports
   `@zilar/runner#typecheck HIT`.
3. `cd apps/runner && pnpm exec tsc --noEmit` (the package's own `typecheck` script) reproduces
   the merge failure: 21 errors, all in `packages/xmpp-core/src`:

```text
../../packages/xmpp-core/src/core-effect.ts(1,51): error TS7016: Could not find a declaration file for module '@xmpp/client'. '.../node_modules/.pnpm/@xmpp+client@0.14.0/node_modules/@xmpp/client/index.js' implicitly has an 'any' type.
  Try `npm i --save-dev @types/xmpp__client` if it exists or add a new declaration (.d.ts) file containing `declare module '@xmpp/client';`
../../packages/xmpp-core/src/core-effect.ts(209,27): error TS7006: Parameter 'raw' implicitly has an 'any' type.
../../packages/xmpp-core/src/stanza/resolve-sender.ts(1,34): error TS7016: Could not find a declaration file for module '@xmpp/client'. ...
../../packages/xmpp-core/src/stream-management.ts(1,46): error TS7016: Could not find a declaration file for module '@xmpp/client'. ...
```

Root cause (my reading, no fix applied because `apps/runner/tsconfig.json` is outside this task's Allowed files):
- `@xmpp/client@0.14.0` ships no declarations; the ambient types live in
  `packages/xmpp-core/src/types/xmpp.d.ts`.
- `apps/server/tsconfig.json` includes that file explicitly: `"include": ["src", "../../packages/xmpp-core/src/types/xmpp.d.ts"]`.
- `apps/runner/tsconfig.json` only has `"include": ["src"]`. `apps/runner/src/e2e.test.ts` imports
  `@zilar/server/src/...`, which pulls in `@zilar/xmpp-core` source, so the runner program compiles
  xmpp-core without its ambient declaration and gets TS7016 there.
- `git diff main -- apps/runner packages/xmpp-core` is empty: the same failure exists on main and
  only shows up when the runner becomes "affected" (my server change makes it a dependent). Main
  passed earlier because nothing made the runner typecheck run.
- Suggested one-line fix, for the lead: add `../../packages/xmpp-core/src/types/xmpp.d.ts`
  to `include` in `apps/runner/tsconfig.json`, mirroring `apps/server/tsconfig.json`.

I stopped here as instructed. `status` stays `merged`; this note is the only change in this round.

Round 2: `apps/runner/tsconfig.json` now has `"include": ["src", "../../packages/xmpp-core/src/types/xmpp.d.ts"]` (mirroring `apps/server/tsconfig.json:8`); `cd apps/runner && pnpm exec tsc --noEmit` prints nothing and exits 0, and `pnpm gate` ends `GATE PASS` (typecheck 2.7s, `@zilar/runner#typecheck` is a HIT in the gate's cache dir afterwards, so the gate really typechecked it).

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `6ed1f318b`.
- **The T-1803 refusal is gone:** the guard, its text, its comment and the now-unused import.
- **The DM test** now posts a poll in the owner's DM as `chat` and records it once with no group or topic.
- **The guide line** reads "In a direct chat only the owner can answer an interactive card."
- **Not tried live yet:** the lead doesn't write in Julio's DMs. Julio can try it in his DM with Deepseek ("ask me with buttons …").
