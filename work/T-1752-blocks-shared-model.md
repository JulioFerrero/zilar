---
id: T-1752
title: "Blocks B3: shared view helpers for message blocks in chat-core (change tone, sparkline path, checklist count, status and callout tones, link host), used by web and phone"
status: merged
milestone: M5
branch: task/T-1752-blocks-shared-model
model: auto
effort: default
depends_on: [T-1749]
estimate: 25 min
---

# T-1752: Shared block view helpers

## Spec (written by Claude, do not edit)

### Why
Message blocks (`docs/plan/message-blocks.md`, task B3 in §6) render on web (B4) and phone (B5) at the same time. The small pure decisions both renderers need live in one place, so the two apps can't drift.

### Facts (read by the lead on 2026-10-16)
- **The block types** (T-1749) are exported from `@zilar/protocol`:
  - `Block`, `BlocksData` and `Change` (`{ direction: 'up' | 'down' | 'flat'; text }`);
  - `FigureBlock`, `NumberBlock` (`points?: number[]`, 2–30 finite numbers), `ChecklistBlock` (`items: { id, label, done, by? }[]`), `StatusBlock` (`status: 'ok' | 'warn' | 'bad'`), `LinkBlock` (`url`, https only) and `CalloutBlock` (`tone: 'success' | 'warning' | 'error' | 'info'`);
  - they're in `packages/protocol/src/blocks-numbers.ts`, `blocks-progress.ts` and `blocks-content.ts`.
- **`packages/chat-core` already depends on `@zilar/protocol`** (`packages/chat-core/package.json:14`). Its index re-exports modules one per line (`packages/chat-core/src/index.ts`, 52 lines).
- **A payload that fails to decode never reaches a renderer:** `decodePayload` rejects an unknown block kind, and the message then shows its plain body, which is the `fallback`. So no "drop unknown kinds" logic is needed.
- **The design** for the six Wave 1 blocks (01 figures, 02 big number, 08 checklist, 12 status, 19 link, 25 callout) is in `docs/design/mockups/blocks/` (see its `README.md`).

### Steps
1. **Create `packages/chat-core/src/blocks.ts`** (no React, pure functions, under 120 lines):
   - `export type BlockTone = 'positive' | 'negative' | 'neutral' | 'warning' | 'info';`
   - `changeTone(change: Change): BlockTone` maps up to positive, down to negative, and flat to neutral.
   - `statusTone(status: StatusBlock['rows'][number]['status']): BlockTone` maps ok to positive, warn to warning, and bad to negative.
   - `calloutTone(tone: CalloutBlock['tone']): BlockTone` maps success to positive, warning to warning, error to negative, and info to info.
   - `sparklinePath(points: readonly number[], width: number, height: number, pad = 2): string` returns an SVG path `d` (`M x y L x y …`) scaled to the box.
     - When every point is equal, it's a flat line at mid-height.
     - Round to 1 decimal place.
     - With fewer than 2 points, return `''`.
   - `checklistCount(block: ChecklistBlock): { done: number; total: number }`.
   - `linkHost(url: string): string`: the hostname without a leading `www.`, or `''` when parsing fails.
     - chat-core's TypeScript lib is ES2023 only (`tsconfig.base.json:5`), so the DOM `URL` type is absent.
     - Reach the runtime constructor the way `packages/protocol/src/blocks-numbers.ts` does: a tiny local `UrlLike` type via `globalThis`. Or parse the host with a small regex on `^https://([^/?#]+)`. Either is fine; don't widen the lib.
   - Add a one-line comment on each function: what it decides, and that web and phone both use it.
2. **Export it** from `packages/chat-core/src/index.ts` with one `export * from './blocks';` line, next to the other view modules.
3. **No tests:** this is shared view code, and the project rule keeps tests to auth, money and the message pipeline.

### Allowed files
- `packages/chat-core/src/blocks.ts`
- `packages/chat-core/src/index.ts`
- `work/T-1752-blocks-shared-model.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `@zilar/chat-core` exports the six helpers, typed against the protocol block types.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added `packages/chat-core/src/blocks.ts` (82 lines, pure, no React):
  - `BlockTone` = `positive | negative | neutral | warning | info`.
  - `changeTone(Change)`: up → positive, down → negative, flat → neutral.
  - `statusTone(StatusBlock['rows'][number]['status'])`: ok → positive, warn → warning, bad → negative.
  - `calloutTone(CalloutBlock['tone'])`: success → positive, warning → warning, error → negative, info → info.
  - `sparklinePath(points, width, height, pad = 2)`: returns the SVG `d` (`M x y L x y …`) scaled into the padded box, y inverted so the max sits at the top; a flat series sits at `height / 2`; coordinates rounded to 1 decimal; `''` for fewer than 2 points.
  - `checklistCount(ChecklistBlock)`: `{ done, total }`.
  - `linkHost(url)`: the `https://` host without a leading `www.`, `''` when there is no host. Parsed with the regex `^https:\/\/(?:[^@/?#]*@)?([^:/?#]+)`, so chat-core's ES2023-only lib never needs the DOM `URL` type.
  - Every function has a one-line comment saying what it decides and that web and phone both use it.
- Added `export * from './blocks';` to `packages/chat-core/src/index.ts`, right after `./sender-color`.
- No tests: per the spec and the project rule (shared view code).

Deviation: the first attempt reached the host through `globalThis.URL` inside a `try`/`catch`, which failed the gate's `effect` check (signal `W4`, "needs Effect"). I switched to the regex the spec offers as the alternative. No lib widening, no Effect needed.

### Checks run
- `pnpm install --frozen-lockfile` → Done in 12.9s.
- `pnpm gate` (first run) → **GATE FAIL** on `effect`: `packages/chat-core/src/blocks.ts needs Effect (W4)` (the `try {` in `linkHost`). Fixed as noted above.
- `pnpm gate` (final run):
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`, `PASS  effect`, `PASS  tests @zilar/chat-core`
  - `scope: every changed file is inside the Allowed files`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- No single test files were run: the spec says no tests, and `pnpm gate` ran the nearest package tests once.

### Notes for the lead
- `linkHost` also strips userinfo (`user@`) and a port, not only `www.`; the spec's regex alternative allowed this. Worth a glance if the display host should ever keep a port.
- `sparklinePath` assumes a valid `width`/`height` (the renderer's box); it does not guard against non-positive sizes.

## Review (written by Claude)

- **Accepted at `a97d36ece`.** It's clean (2 cosmetic nits) and 82 lines.
- **The lead read every function.**
  - The three tone maps are exhaustive switches.
  - `sparklinePath` scales into the padded box: a flat series sits on the mid-line, fewer than 2 points draw nothing, and it rounds to 1 decimal.
  - `checklistCount` returns the done and total counts.
  - `linkHost` is a regex that ignores a `user@` prefix and a port, and needs no DOM lib.
- **No tests,** as the spec said (shared view code).
- **Next:** B4 and B5 (web and phone, the first 6 blocks) use these helpers.
