---
id: T-1264
title: "Lead tooling: a provider auth failure (OpenCode `provider.auth`, 401 'Invalid credential') counts like a quota error, so workers, pre-reviews and the doctor fall back in place to the next model instead of stalling silently"
status: merged
milestone: M5
branch: task/T-1264-fallback-on-provider-auth
model: auto
effort: default
depends_on: []
estimate: 0.1 day
---

# T-1264: Fall back on a provider auth failure

## Spec (written by Claude, do not edit)

### Why
On 2026-10-12 evening, every pre-review on the free Muse (`opencode/muse-spark-1.3-contributor-free`, `PREREVIEW_MODEL` in `packages/devtools/src/lead/start-prereview.ts:11`) failed at once. The session's error was:
`{"type":"provider.auth","message":"Upstream request failed: Invalid credential","status":401}`

The autopilot only printed `PRE-REVIEW STALLED … (idle, no PREREVIEW.md)` for T-1262 and T-1263, because `containsQuotaError` (`packages/devtools/src/lead/session.ts:51-76`) recognises `provider.quota`, `provider.rate-limit`, 402/429 and limit/quota text, but not an auth failure. So nothing fell back. The lead switched both sessions to the paid Muse by hand (`session.switchModel`), and they ran fine.

### What to build
1. **`session.ts`:** in `containsQuotaError`, also return true for a provider-typed object with `type === 'provider.auth'`, or a `status` of 401 together with an `error`/`message`/`code` (the same guard as the 402/429 branch at `:62-68`).
   - Update the comment above it (`:41-50`) to say why: an expired or invalid provider credential must move work onto the fallback chain like a quota error.
   - Keep the provider-typed restriction, so ordinary message text never matches.
2. **The autopilot's FALLBACK line** (`packages/devtools/src/lead/decide.ts:135` area) already says "failed or rate-limited". Keep it.
3. **Tests**, in `packages/devtools/src/lead/session.test.ts` (60 lines), up to 2:
   - a `provider.auth` 401 error flags quota;
   - a later normal assistant reply clears it (as the existing recovery test does for `provider.quota`).

### Read first
`AGENTS.md`, `packages/devtools/src/lead/session.ts`, `packages/devtools/src/lead/session.test.ts`, `packages/devtools/src/lead/decide.ts:120-140` and `work/T-1242-workers-on-opencode-go.md`.

### Allowed files
`packages/devtools/src/lead/session.ts`, `packages/devtools/src/lead/session.test.ts`, `work/T-1264-fallback-on-provider-auth.md`.

### Checks
```bash
pnpm --filter @zilar/devtools exec vitest run src/lead/session.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. After the merge, the lead restarts the autopilot.

---

## Report (written by the worker when done)

Status: done, ready for review. `pnpm gate` ends with `GATE PASS` and lists no files outside the Allowed files.

### What I did

1. **`session.ts` (`containsQuotaError`).** Added `type === 'provider.auth'` to the provider-type check, and `401` alongside `402`/`429` in the status check that requires an `error`/`message`/`code` key (the same guard the 402/429 branch already used). The provider-text branch (`limit|quota` on a `provider.*` object) is untouched, so ordinary message/tool text still cannot match. Rewrote the comment above the function to say why: an expired or invalid provider credential must move work onto the fallback chain like a quota error instead of stalling silently.
2. **Autopilot FALLBACK line** (`decide.ts:135`): unchanged, as the spec says ("failed or rate-limited" stays).
3. **Tests** (`session.test.ts`). Added one describe block (T-1264) with two cases: a `provider.auth` 401 error flags `quotaError`; a later normal assistant reply clears it. The existing T-1242 tests are untouched.

### Files changed (all inside Allowed files)

- `packages/devtools/src/lead/session.ts`
- `packages/devtools/src/lead/session.test.ts`
- `work/T-1264-fallback-on-provider-auth.md`

### Commands and real results

- `pnpm install` — done, `+1181` packages, 9.3s, no errors (only pre-existing peer-dep/deprecation warnings).
- `pnpm --filter @zilar/devtools exec vitest run src/lead/session.test.ts --reporter=dot --maxWorkers=2` — `Test Files 1 passed (1)`, `Tests 7 passed (7)`.
- `pnpm gate` (final) — summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (0.7s)
  PASS  lint  (1.0s)
  PASS  typecheck  (2.5s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/devtools  (0.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Deviations / notes

- The spec's step 1 says "a provider-typed object with `type === 'provider.auth'`, or a `status` of 401 together with an `error`/`message`/`code` (the same guard as the 402/429 branch)". I read the second clause as a bare-status guard exactly mirroring the existing 402/429 branch (which is itself not provider-typed — the existing T-1242 test flags a bare `{ type: 'error', status: 429, message: … }`). "Keep the provider-typed restriction" therefore stays true for the text-regex branch, which I did not change. If the intent was to require provider-typing on the 401 branch too, say so and I will tighten it.
- Nothing else changed; no state files, no `decide.ts`.

### Acceptance

- The Checks pass and the gate is green.
- The lead restarts the autopilot after the merge (as the spec's Acceptance says); I did not do that.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (1 nit). That pre-review itself ran on the paid Muse after the lead switched it by hand: the free Muse answered 401.**
- **The change:** `containsQuotaError` adds `provider.auth` and status 401 (with the same `error`/`message`/`code` guard as 402/429). The comment explains why; the provider-typed restriction is kept.
- **Lead's check:** `session.test.ts`, 7 passed.
- **After merge:** the lead restarts the autopilot.
