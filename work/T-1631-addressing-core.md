---
id: T-1631
title: "Smart wake step 2 (plan docs/plan/smart-wake.md §5.2): a pure addressing module that decides whether a person's group message is for this AI — name address V1–V3, one-AI-room question S, follow-up question R — with tests; not wired yet"
status: merged
milestone: M5
branch: task/T-1631-addressing-core
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1631: The addressing core

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-16): "the ai needs to be also smart enough to understand that needs to answer and do the job".

The plan `docs/plan/smart-wake.md` (T-1621, merged) recommends free deterministic rules first (§2(a), §3). This task builds **only the pure decision module and its tests**. Wiring it into ingest is the next task, so behaviour doesn't change yet.

### Facts (the lead read them on 2026-10-16)
- **The rules** are in `docs/plan/smart-wake.md` §2(a), lines 67-87: V1 (address at the start), V2 (`@N` anywhere), V3 (a mid-sentence vocative), rule S (a room with exactly one AI, a question), rule R (a question right after this AI's own reply), the accepted false positives, and the floor of names of 4 or more characters for V1 and V3.
- **`apps/server/src/agents/gateway/typed-mention.ts`** (41 lines, T-1617) already exports `bodyAddressesAi(body, names)`. That covers `@N` with boundaries, and `N,` or `N:` at the start.

### Steps
1. **New file `apps/server/src/agents/gateway/addressing.ts`** (pure, no I/O):
   - `export function isQuestion(body: string): boolean`: look only at the first non-empty line, trimmed. It is a question when it ends with `?`, or starts (case-insensitive, whole word) with one of `what where when who whom whose why how which can could would will does do did is are am was were should shall may might`. Document the list.
   - `export type WakeReason = 'address' | 'one_ai_question' | 'follow_up_question';`
   - `export function decideWake(input: { body: string; names: readonly string[]; liveAisInRoom: number; lastOwnReplyAtMs: number | null; otherAiRepliedSince: boolean; nowMs: number; rules: { oneAiQuestion: boolean; followUpQuestion: boolean } }): WakeReason | null`. In order:
     - **`address`:** `bodyAddressesAi(body, names)` (V2 and T-1617's start rule); **or** V1, the body (after leading whitespace) starts with a name of at least 4 characters followed by whitespace, `,` or `:`; **or** V3, a name of at least 4 characters followed by `,` or `:` anywhere, with a word boundary before it. Case-insensitive, regex-escaped.
     - **`one_ai_question`:** only when `rules.oneAiQuestion` is set, `liveAisInRoom === 1` and `isQuestion(body)`.
     - **`follow_up_question`:** only when `rules.followUpQuestion` is set, `lastOwnReplyAtMs !== null`, `nowMs - lastOwnReplyAtMs <= 120_000`, `!otherAiRepliedSince` and `isQuestion(body)`.
     - otherwise `null`.
2. **Tests** in `apps/server/src/agents/gateway/addressing.test.ts`, for the message pipeline:
   - V1: `Deepseek run the tests` → address. A 3-character name `Bob run` → null (the floor).
   - V3: `ok Deepseek, do it` → address. `I like Deepseeker, a lot` → null.
   - The email case `mail a@deepseek.com` → null.
   - `isQuestion`: `what is BTC at?` → true; `BTC price?` → true; `whatever.` → false; the second line `?` only → false.
   - S on and off, and R with its window, `otherAiRepliedSince` and the 120 s edge.
3. **Don't wire it anywhere.**

### Allowed files
- `apps/server/src/agents/gateway/addressing.ts`
- `apps/server/src/agents/gateway/addressing.test.ts`
- `work/T-1631-addressing-core.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway/addressing.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`decideWake` and `isQuestion` behave as listed,** with tests.
- **No other file changes.**

---

## Report (written by the worker when done)

### What I did

Built the pure addressing module for smart wake step 2 and its tests. Nothing is wired anywhere.

- `apps/server/src/agents/gateway/addressing.ts` (new, 143 lines):
  - `isQuestion(body)`: looks only at the first non-empty line, trimmed; true if it ends with `?` or opens (case-insensitive, whole word) with one of `what where when who whom whose why how which can could would will does do did is are am was were should shall may might` (the list is documented in a comment).
  - `decideWake(input)`: returns, in order, `address` (via `bodyAddressesAi` — V2 and T-1617's start rule — or V1 `^\s*@?Name[,\s:]` or V3 `(?:^|\W)Name[,:]`, both only for names of 4+ characters, case-insensitive and regex-escaped), then `one_ai_question` (rule S: `rules.oneAiQuestion && liveAisInRoom === 1 && isQuestion`), then `follow_up_question` (rule R: `rules.followUpQuestion && lastOwnReplyAtMs !== null && nowMs - lastOwnReplyAtMs <= 120_000 && !otherAiRepliedSince && isQuestion`), else `null`.
- `apps/server/src/agents/gateway/addressing.test.ts` (new): 15 tests covering V1 and the 3-character floor, V3 and the `Deepseeker` near-miss, the email case, `isQuestion` (trailing `?`, question word, `whatever.`, and a `?` on the second line only), S on/off and room-size, and R with the window, the 120 s edge, `otherAiRepliedSince`, no prior reply and the rule off.

No other files changed. The spec's Checks command used `pnpm --filter @zilar/server exec vitest run ...`; I ran the AGENTS.md form (`pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot <path>`), which runs the same file.

### Checks run

- `pnpm install` — done, 14.9s, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/addressing.test.ts` — **15 passed (15)**, 1 file.
- `pnpm gate` (first run) — **GATE FAIL**: `FAIL format` on `addressing.test.ts`; all other steps passed. Fixed with `pnpm exec prettier --write` on my two files.
- `pnpm gate` (second run) — **GATE PASS**:
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `gate: 3 changed file(s) against main` (the two new source files + this task file)

### Notes for the lead

- V1 as written is `^\s*@?Name[,\s:]`; the optional `@` matches the plan's `^@?N[,:\s]` and is redundant with `bodyAddressesAi` (`@N` is already V2), so it changes no behaviour. Say the word if you want it dropped.
- V3's "word boundary before it" is implemented as `(?:^|\W)`, i.e. the preceding character must be a non-word character (JS `\W`). That matches the intent in the plan.
- Rule R compares `nowMs - lastOwnReplyAtMs <= 120_000` exactly as specified; a negative difference (clock skew) would also fall inside the window. Kept literal to the spec.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 2 nits. One is the clock-skew edge in rule R; T-1633 stamps both sides with `Date.now()`, so it can't happen.
- **The tests:** the lead ran `addressing.test.ts`: 15 passed. The module is pure and not wired yet; T-1633 wires it.
- **Watch after T-1633 is live:** the question-word list includes imperatives like "do", "will" and "may", so "Will do." counts as a question. In a one-AI room, rule S would wake the AI on it. If Julio finds it noisy, trim the list to the wh-words plus a trailing `?`.

