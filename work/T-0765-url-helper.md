---
id: T-0765
title: "R3: pure URL helpers in chat-core (parseUrl, safeDecode in packages/chat-core/src/url.ts with an effect-plain marker), web MarkdownText.tsx and ChatShell.tsx use them instead of their own try/catch"
status: todo
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

## Review (written by Claude)
