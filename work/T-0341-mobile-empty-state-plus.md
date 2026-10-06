---
id: T-0341
title: "Mobile: the Plus icon on the Machines and Connections empty-state buttons is drawn in the accent foreground, not white"
status: todo
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

## Review (written by Claude)
