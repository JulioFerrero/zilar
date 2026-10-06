---
id: T-0391
title: "Mobile guard test: a hand-rolled Pressable with a solid bg-accent or bg-danger fails the tests (radios excepted); use the kit Button"
status: todo
milestone: M5
branch: task/T-0391-mobile-no-solid-pill-guard
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0391: mobile guard against hand-rolled solid pills

## Spec (written by Claude, do not edit)

### Why
- T-0349, T-0356 and T-0360 to T-0387 moved every mobile accent and danger text button to the kit `Button`.
- The web has a guard test for this (`apps/web/src/components/ui/no-accent-pill.test.ts`, T-0376); mobile has none.
- Two contrast bugs (dark text on a red `Pressable`) were found on the emulator only, in QA run 29.

### Verified facts (do not re-derive)
- **Web reference (`apps/web/src/components/ui/no-accent-pill.test.ts`):**
  - it matches whole class tokens with regexes like `SOLID_ACCENT = /(^|[\s'"`])bg-accent(?![/-])/`;
  - it attributes a hit to the nearest `<Tag` on the same line before the column, or else on the lines above (`nearestTag`);
  - it flags only interactive tags;
  - it has unit cases plus one scan over all sources (with a minimum-scanned assertion).
- **Mobile file-walk pattern (`apps/mobile/src/lib/routes-dir.test.ts`):** `readdirSync(dir, { withFileTypes: true })` recursion from `join(__dirname, '..', 'app')`, using `node:fs` and `node:path`.
- **Today's whole-token solid `bg-accent` and `bg-danger` hits in non-test mobile `.tsx` outside `components/ui/`:**
  - `app/settings/connections.tsx:422`: a `Pressable` with `accessibilityRole="radio"` (line 416), the selected provider chip. Allowed.
  - `components/settings/avatar-control.tsx:99`, `components/chat/folder-tabs.tsx:79`, `components/chat/progress-card.tsx:26`, `components/ais/option-row.tsx:53` and `components/ais/wizard-steps.tsx:10-11`: `View`s or class maps. Not interactive.
  - `components/chat/voice-recorder.tsx:383`: a `View` dot.
  - After T-0387 (merged), no `Pressable` carries a solid `bg-danger`.

### What to build
1. **New test `apps/mobile/src/components/ui/no-solid-pill.test.ts`**, written like the web guard:
   - Walk every `.tsx` under `apps/mobile/src`, skipping `*.test.*` files and the `components/ui/` folder (the kit itself).
   - Flag a whole-token solid `bg-accent` or `bg-danger` (not `/opacity`, not `-foreground`, not prefixed like `active:bg-accent/90`) whose nearest tag is `Pressable`, `TouchableOpacity` or `Link`.
   - Skip the hit when that element's opening tag (from `<Pressable` to its first `>` at the end of a line) contains `accessibilityRole="radio"`, `"tab"` or `"checkbox"`; selected states use a solid fill by design.
   - The message names the file:line and says "use the kit Button from '@/components/ui/button' (variant default or destructive)".
2. **Unit cases:**
   - flags `<Pressable className="rounded-full bg-accent px-3">`;
   - flags a multi-line `bg-danger`;
   - allows `<View className="bg-accent">`, `bg-accent/10`, `active:bg-accent/90` and a radio `Pressable`.
3. **A scan case** asserting no hits and more than 100 files scanned.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/no-accent-pill.test.ts`, `apps/mobile/src/lib/routes-dir.test.ts` and `apps/mobile/src/app/settings/connections.tsx:410-430`.

### Allowed files
`apps/mobile/src/components/ui/no-solid-pill.test.ts`, `work/T-0391-mobile-no-solid-pill-guard.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot no-solid-pill
pnpm gate
```

### Acceptance
- The guard's unit cases pass, and the scan finds no hits on main.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
