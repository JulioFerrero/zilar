---
id: T-0341
title: "Mobile: the Plus icon on the Machines and Connections empty-state buttons is drawn in the accent foreground, not white"
status: merged
milestone: M5
branch: task/T-0341-mobile-empty-state-plus
model: auto
effort: low
depends_on: [T-0340]
estimate: 0.1 day
---

# T-0341: empty-state Plus colour

## Spec (written by Claude, do not edit)

### Why
The accent is `#ededed` and the accent foreground is `#0a0a0a`, in both schemes (`packages/ui-tokens/src/index.ts:23-24`). Two empty-state buttons draw a white Plus on the near-white accent, so the icon is almost invisible. The label next to it uses `text-accent-foreground` and reads fine. The T-0340 pre-review found the first one.

### Verified facts (do not re-derive)
- **`apps/mobile/src/app/settings/machines.tsx:313`:**
  - `<Plus size={16} color="#fff" />` inside the "Add a machine" `Pressable` (`bg-accent`);
  - it is in `MachinesList`, which already has `const scheme = asColorScheme(useColorScheme().colorScheme);` (line 41);
  - the file already imports `ACCENT_FOREGROUND` from `@/lib/colors` (T-0340).
- **`apps/mobile/src/app/settings/connections.tsx:220`:**
  - `<Plus size={16} color="#fff" />` inside the "Add a connection" `Pressable` (`bg-accent`);
  - it is in `ConnectionsList`, which has `scheme` at line 63;
  - line 31 imports `ACCENT, ICON` from `@/lib/colors`.
- **`apps/mobile/src/components/connections/connections-screen.test.tsx:70-74`:** mocks `@/lib/colors` as `{ ACCENT, ICON, MUTED_FOREGROUND }`. Add `ACCENT_FOREGROUND` there (mocks only).
- The other two `#ffffff` icons are white on purpose; leave them:
  - `apps/mobile/src/components/chat/attachment-video.tsx:184` is a Play icon over a dark video scrim;
  - `apps/mobile/src/components/contacts/profile-card.tsx:294` is a Ban icon on a destructive red button, whose text is white.

### What to build
1. In both places, change `color="#fff"` to `color={ACCENT_FOREGROUND[scheme]}`. Import `ACCENT_FOREGROUND` in `connections.tsx`.
2. In each of the two screen tests, add one assertion: render the empty state and check that the Plus mock receives the accent foreground colour, not `#fff`.
   - If the existing test setup cannot reach the empty state cheaply, skip the assertion and say why in the Report.
   - The Machines test is `apps/mobile/src/components/machines/machines-screen.test.tsx`.

### Read first
`AGENTS.md`, the two lines above with their surrounding components, and the two screen tests.

### Allowed files
`apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/app/settings/connections.tsx`, `apps/mobile/src/components/machines/machines-screen.test.tsx`, `apps/mobile/src/components/connections/connections-screen.test.tsx`, `work/T-0341-mobile-empty-state-plus.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot machines-screen connections-screen
pnpm gate
```

### Acceptance
- No `color="#fff"` remains in `apps/mobile/src/app/settings/`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/mobile/src/app/settings/machines.tsx:313`: changed the "Add machine" `Plus` from `color="#fff"` to `color={ACCENT_FOREGROUND[scheme]}` (`ACCENT_FOREGROUND` was already imported).
- `apps/mobile/src/app/settings/connections.tsx:31,220`: imported `ACCENT_FOREGROUND` from `@/lib/colors` and changed the "Add a connection" `Plus` from `color="#fff"` to `color={ACCENT_FOREGROUND[scheme]}`.
- `apps/mobile/src/components/machines/machines-screen.test.tsx`: in the existing empty-state test, added `expect(html).toMatch(/<Plus[^>]*color="#0a0a0a"/)` and `expect(html).not.toContain('color="#fff"')`. Also corrected the mock's `ACCENT_FOREGROUND` value from `#ededed` (same as the accent) to the real token `#0a0a0a` so the assertion can tell the foreground from the accent.
- `apps/mobile/src/components/connections/connections-screen.test.tsx`: added `ACCENT_FOREGROUND: { dark: '#0a0a0a', light: '#0a0a0a' }` to the `@/lib/colors` mock and the same two assertions in the existing empty-state test.

### Files changed
- `apps/mobile/src/app/settings/machines.tsx`
- `apps/mobile/src/app/settings/connections.tsx`
- `apps/mobile/src/components/machines/machines-screen.test.tsx`
- `apps/mobile/src/components/connections/connections-screen.test.tsx`
- `work/T-0341-mobile-empty-state-plus.md`

### Commands and results (real)
- `pnpm install`: Done, exit 0 (1170 packages; pre-existing `@types/react-dom` peer warning only).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot machines-screen connections-screen`: Test Files 2 passed (2), Tests 11 passed (11), exit 0.
- `pnpm gate` (repo root): `gate: 5 changed file(s) against main`; `PASS install (frozen) (0.9s)`; `PASS format (11.3s)`; `PASS lint (1.2s)`; `PASS typecheck (5.8s)`; `PASS tests @zilar/mobile (1.4s)`; `scope: every changed file is inside the Allowed files`; `GATE PASS`; exit 0.
- Acceptance check: grep for `#fff|#ffffff` under `apps/mobile/src/app/settings/` -> no matches.

### Deviations / notes
- The spec said "add one assertion"; each test got two `expect` lines that together are the single check the spec describes (the accent-foreground match plus the "not `#fff`" guard). Nothing was skipped.
- The machines test mock already had `ACCENT_FOREGROUND` (from T-0340) but with the accent value `#ededed`; I corrected it to the real `#0a0a0a` so the assertion is meaningful. This is inside an Allowed file.
- The two intentional white icons (`attachment-video.tsx:184`, `profile-card.tsx:294`) were left untouched, as the spec says.

### Open questions
- None.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). Both empty-state Plus icons now use `ACCENT_FOREGROUND[scheme]`, and no `color="#fff"` remains in `apps/mobile/src/app/settings/` (lead grep). The tests assert the colour.
