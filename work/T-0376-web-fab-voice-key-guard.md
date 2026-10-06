---
id: T-0376
title: "Web kit: the New chat FAB and the voice play button use the kit Button; the pill guard also flags hand-rolled key-primary and solid bg-danger buttons"
status: merged
milestone: M5
branch: task/T-0376-web-fab-voice-key-guard
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0376: last key-primary buttons on the kit, wider guard

## Spec (written by Claude, do not edit)

### Why
Since T-0365 to T-0373, only two web files outside the kit still hand-roll `key-primary`, and none hand-roll a solid `bg-danger` button. A guard keeps it that way.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:** `default` = `key-primary`; size `icon-lg` is `size-9`; `cn` merges a caller `className`, so `size-14` or `size-10` override the size.
- **`apps/web/src/components/NewChatButton.tsx:170`:** `<button ref={triggerRef} aria-label="New chat" aria-haspopup="menu" aria-expanded={menuOpen} onClick={toggleMenu} className="key-primary flex size-14 items-center justify-center rounded-[18px]">` with `<Plus className="size-[22px]" />`. `Button` is imported at line 8.
- **`apps/web/src/components/VoiceMessage.tsx:221`:**
  - `<button aria-label={playing ? 'Pause voice message' : 'Play voice message'} aria-disabled={!playable} … onClick={togglePlay} className={cn('key-primary flex size-10 shrink-0 items-center justify-center rounded-full', !playable && 'opacity-50')}>`;
  - the file does not import `Button`.
- **`grep -rn "key-primary" apps/web/src --include='*.tsx'`**, outside `components/ui/` and tests, finds only these two lines. A solid `bg-danger` on a button finds nothing (the only solid `bg-danger` hits are a `span` in `Composer.tsx:947` and a bar `div` in `ais/AiPanel.tsx:88`).
- **`apps/web/src/components/ui/no-accent-pill.test.ts`:**
  - `SOLID_ACCENT = /(^|[\s'"`])bg-accent(?![/-])/`;
  - `INTERACTIVE_TAGS = {button, a, Link}`;
  - `findAccentPills(source)` returns `{line, tag}`;
  - the scan test `finds no hand-rolled accent pill …` covers every non-test web source outside the kit directory.
- **Tests:** `apps/web/src/components/NewChatButton.test.tsx`, `apps/web/src/components/VoiceMessage.test.tsx` and `apps/web/src/components/VoiceMessage.player.test.tsx`.

### What to build
1. **NewChatButton:** the FAB becomes `<Button ref={triggerRef} type="button" size="icon-lg" className="size-14 rounded-[18px]" …>`, keeping every aria prop, `onClick` and the icon.
2. **VoiceMessage:** the play button becomes `<Button type="button" size="icon-lg" className={cn('size-10 shrink-0 rounded-full', !playable && 'opacity-50')} …>`, keeping `aria-label`, `aria-disabled`, the `title` spread and `onClick`. Import `Button` from `@/components/ui/button`.
3. **Guard:** in `no-accent-pill.test.ts`, also flag two more class tokens on `button`/`a`/`Link`:
   - `key-primary`, as a whole token;
   - solid `bg-danger`, as a whole token, not `bg-danger/10` and not `hover:bg-danger/90`.

   Reuse `nearestTag`. Add positive and negative unit cases like the existing ones (for example, `<span className="bg-danger">` and `bg-danger/10` are allowed). Keep the existing names and messages; adjust the hint text to cover all three.
4. The scan test must pass on the tree after steps 1 and 2.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx`, `apps/web/src/components/ui/no-accent-pill.test.ts`, `apps/web/src/components/NewChatButton.tsx:160-185` and `apps/web/src/components/VoiceMessage.tsx:215-240`.

### Allowed files
`apps/web/src/components/NewChatButton.tsx`, `apps/web/src/components/VoiceMessage.tsx`, `apps/web/src/components/ui/no-accent-pill.test.ts`, `apps/web/src/components/NewChatButton.test.tsx`, `apps/web/src/components/VoiceMessage.test.tsx`, `apps/web/src/components/VoiceMessage.player.test.tsx`, `work/T-0376-web-fab-voice-key-guard.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot no-accent-pill NewChatButton VoiceMessage
pnpm gate
```

### Acceptance
- No `key-primary` in `NewChatButton.tsx` or `VoiceMessage.tsx`.
- The guard has new unit cases for `key-primary` and `bg-danger`, and the scan passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Did steps 1–4 of the spec; nothing else touched.

- `apps/web/src/components/NewChatButton.tsx`: FAB is now `<Button ref={triggerRef} type="button" size="icon-lg" className="size-14 rounded-[18px]" …>` with the same aria props, `onClick` and `<Plus className="size-[22px]" />`. No `key-primary` left in the file.
- `apps/web/src/components/VoiceMessage.tsx`: play button is now `<Button type="button" size="icon-lg" className={cn('size-10 shrink-0 rounded-full', !playable && 'opacity-50')} …>` with the same `aria-label`, `aria-disabled`, `title` spread and `onClick`; added `import { Button } from '@/components/ui/button'`. No `key-primary` left in the file. Other `<button>`s in the file (transcript toggles) were already plain text buttons, untouched.
- `apps/web/src/components/ui/no-accent-pill.test.ts`: added `KEY_PRIMARY` (whole token) and `SOLID_DANGER` (whole token, `bg-danger/10`, `hover:bg-danger/90` and `bg-danger-foreground` stay allowed) alongside `SOLID_ACCENT`; `findAccentPills` reuses `nearestTag` and checks all three patterns against `button`/`a`/`Link`. Added unit cases: key-primary flagged on button/a/Link, solid bg-danger flagged on button/a/Link, spans/tints/prefixed forms allowed. Kept the existing test names and messages; hint now reads "use the kit Button … (variant default = key-primary, destructive for danger)".
- Security checklist: no secrets/tokens touched; no deletes/updates, caps, permissions, routes, rate limits or audit entries involved — UI-only change plus a test-only guard.

Commands (real results):
- `pnpm install`: done, exit 0.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot no-accent-pill NewChatButton VoiceMessage`: 4 files, 29 tests passed, exit 0.
- `pnpm gate` (repo root): `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/web`, `scope: every changed file is inside the Allowed files`, `GATE PASS`. Changed files listed: the 3 source/test files above plus this task file — all within Allowed files.

No deviations, no open questions.

## Review (written by Claude)

Approved (lead, 2026-10-06). The New chat FAB and the voice play button are kit `Button` (default = key-primary) with size overrides; no hand-rolled `key-primary` is left outside the kit. The guard now also flags whole-token `key-primary` and solid `bg-danger` on button/a/Link, with positive and negative unit cases, and the scan passes. Pre-review clean (0 findings).
