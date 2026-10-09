---
id: T-0765
title: "R3: pure URL helpers in chat-core (parseUrl, safeDecode in packages/chat-core/src/url.ts with an effect-plain marker), web MarkdownText.tsx and ChatShell.tsx use them instead of their own try/catch"
status: merged
milestone: M5
branch: task/T-0765-url-helper
model: auto
effort: default
depends_on: []
estimate: 0.15 day
---

# T-0765 (R3): one pure URL helper instead of local try/catch

## Spec (written by Claude, do not edit)

### Why
This is Phase 0 of `docs/audit/effect-100-plan.md` (task R3, §3.2). A total parse such as `try { new URL(x) } catch` is pure, but it trips the try/catch signal W4. A single helper with a marker removes those false positives, and mobile reuses it in R4.

### Verified facts (do not re-derive)
- **`apps/web/src/components/MarkdownText.tsx`** (55 lines): `safeUrl(url)` (lines 12-20) wraps `new URL(url)` in a try/catch and checks `ALLOWED_PROTOCOLS`. It is used at line 48. The test is `MarkdownText.test.tsx`.
- **`apps/web/src/routes/ChatShell.tsx`** (68 lines): `decodeParam(value)` (lines 12-21) wraps `decodeURIComponent` in a try/catch, returning the raw value on failure. It is used at line 25. The test is `ChatShell.test.tsx`.
- **`packages/chat-core/src/index.ts`** re-exports its modules (`export * from './links'` and so on). Web and mobile depend on `@zilar/chat-core` (`workspace:*`).
- **The marker format** (T-0758, `packages/devtools/src/effect-map/generate.ts`): a comment `// effect-plain: <reason>` in the first 15 lines makes the file exempt, with a budget of 25. Today 0 are used.

### What to build
1. **`packages/chat-core/src/url.ts`:** `parseUrl(text: string): URL | undefined` and `safeDecode(text: string): string`, which returns the input when decoding fails. Line 1 is `// effect-plain: total parse helpers; a failed parse is a value, not an error`. Export both from `index.ts`.
2. **Tests:** `packages/chat-core/src/url.test.ts` (valid, invalid, a relative URL, a `%` sequence that is broken and one that is good).
3. **`MarkdownText.tsx`:** `safeUrl` uses `parseUrl`, with no try/catch. **`ChatShell.tsx`:** `decodeParam` uses `safeDecode`. The behaviour is identical, and both existing tests pass unchanged.

### Read first
`AGENTS.md`, `docs/audit/effect-100-plan.md` §1.4 and §3.2, the four files.

### Allowed files
`packages/chat-core/src/url.ts`, `packages/chat-core/src/url.test.ts`, `packages/chat-core/src/index.ts`, `apps/web/src/components/MarkdownText.tsx`, `apps/web/src/routes/ChatShell.tsx`, `work/T-0765-url-helper.md`.

### Checks
```bash
pnpm --filter @zilar/chat-core test --reporter=dot src/url
pnpm --filter @zilar/web test --reporter=dot src/components/MarkdownText src/routes/ChatShell
pnpm gate
```
Also run `pnpm effect:map` and say in the Report whether the two web files are now `plain` and `url.ts` is `exempt`.

### Acceptance
- The helpers exist and are tested, and the two web files have no try/catch.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `packages/chat-core/src/url.ts` (new): `parseUrl(text): URL | undefined` and `safeDecode(text): string`, each a try/catch around one call. Line 1 is the `// effect-plain:` marker from the spec.
- `packages/chat-core/src/url.test.ts` (new): 5 tests (valid URL, invalid, empty, relative, a good `%` sequence, a broken `%` sequence).
- `packages/chat-core/src/index.ts`: `export * from './url';`.
- `apps/web/src/components/MarkdownText.tsx`: `safeUrl` uses `parseUrl`, no try/catch. Behaviour unchanged.
- `apps/web/src/routes/ChatShell.tsx`: `decodeParam` keeps its `undefined` check and returns `safeDecode(value)`, no try/catch.
- `work/T-0765-url-helper.md`: Report and status only.

### Deviations from the spec (please read)
1. **`/// <reference lib="dom" />` added at line 2 of `url.ts`.** `packages/chat-core/tsconfig.json` extends the base with `lib: ["ES2023"]` and no DOM types, so `new URL` failed typecheck (`TS2304: Cannot find name 'URL'`, two errors). I could not edit that tsconfig (not in Allowed files), so I used the directive inside the Allowed file. The directive is global to the program, so I checked the consumers: `pnpm --filter @zilar/chat-core typecheck`, `@zilar/mobile typecheck` and `@zilar/web typecheck` all exit 0 with it (mobile: 0 `error TS`, web: 0). The gate's typecheck step also passed. A cleaner fix would be a `"DOM"` lib in `packages/chat-core/tsconfig.json`; that is for Claude to decide.
2. **`git add` of the two new files** (`url.ts`, `url.test.ts`). `effect:map` lists files with `git ls-files`, so untracked files are invisible to it. Staging is not a branch change.
3. The test commands use `--maxWorkers=2 --reporter=dot` as AGENTS.md asks.

### Commands and real results
- `pnpm install`: done, exit 0.
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/url`: 1 file passed, **5 tests passed**.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/MarkdownText src/routes/ChatShell`: **2 files passed, 18 tests passed** (the existing `MarkdownText.test.tsx` and `ChatShell.test.tsx`, unchanged).
- First `pnpm gate`: **GATE FAIL** on `@zilar/chat-core#typecheck` (the TS2304 above). Fixed with deviation 1.
- `pnpm gate` (final, from the worktree root, log outside the worktree): 
  - `gate: 6 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/chat-core`, `PASS tests @zilar/web`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- `pnpm effect:map` (final run): `effect-map: 839 files, coverage 47.2% (effect 200, needs-effect 243, plain 302, exempt 94, legacy 0), tier B 128, markers 1/25`.
  - `apps/web/src/components/MarkdownText.tsx`: **plain**
  - `apps/web/src/routes/ChatShell.tsx`: **plain**
  - `packages/chat-core/src/url.ts`: **exempt** (reason: "total parse helpers; a failed parse is a value, not an error")
- `grep -n "try\|catch"` on the two web files: no match.

### Open questions
- Is the `dom` lib directive in `url.ts` acceptable, or should chat-core's tsconfig get `"DOM"` in its lib (a file outside my Allowed list)? Mobile is the one for R4 to reuse this helper, so the choice affects it.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the diff directly.
- **The helpers:** `parseUrl` and `safeDecode`, with an `effect-plain` marker; `MarkdownText` and `ChatShell` are now plain.
- **The DOM lib reference in `url.ts` is fine:** only web and mobile depend on chat-core, and both have `URL`.
- **Results:** the tests (5 plus 18) and the gate pass.
