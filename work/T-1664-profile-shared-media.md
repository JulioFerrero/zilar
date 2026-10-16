---
id: T-1664
title: "Phone contact panel gets a Shared media row (parity audit gap 9): a small profile-media component shows the row when a DM exists and opens the existing MediaSheet for that DM, jumping to a message the way group info does"
status: merged
milestone: M5
branch: task/T-1664-profile-shared-media
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1664: Shared media in the phone contact panel

## Spec (written by Claude, do not edit)

### Why
Group and channel info on the phone have a "Shared media" row, but the DM contact panel (`/u/[handle]`) doesn't (`docs/audit/parity-2026-10-16.md`, gap 9). Web shows shared media for DMs too.

### Facts (the lead read them on 2026-10-16)
- **`apps/mobile/src/app/u/[handle].tsx`** (315 lines):
  - `const { dmChatId, … } = useProfileDm(…)` (`:217-218`); `dmChatId` is `undefined` when there's no DM;
  - the profile body renders `ProfileHeader`, `ProfileActions`, `ProfileInfo` (`:290-294`), then `ProfileBlock` (`:295-302`).
- **The group-info pattern to copy:**
  - the row `<InfoRowGroup><InfoRow icon={Image} label="Shared media" onPress={onOpenMedia} />…` (`apps/mobile/src/components/group-info/root-page.tsx:144-145`), with `InfoRow` and `InfoRowGroup` from `@/components/group-info/info-row`;
  - the sheet `{mediaOpen ? <MediaSheet chatId={…} onJump={jump} onClose={…} /> : null}` (`apps/mobile/src/components/group-info/group-info-pages.tsx:164-170`), where `MediaSheet` takes `chatId`, `title?`, `onClose` and `onJump` (`apps/mobile/src/components/chat/media-sheet.tsx:23-28`);
  - the jump (`group-info-pages.tsx:88-108`): `Effect.runFork(openSearchHitEffect({ openAtMessage, pushChat, pushChatNotFound, onNotFound: () => {} }, chatId, messageId).pipe(Effect.catch(() => Effect.void), Effect.catchDefect(() => Effect.void)))`, with `openAtMessage = useChatStore((state) => state.openAtMessage)` (`:57`) and `openSearchHitEffect` from `@/components/chat/search-jump`.
- **`apps/mobile/src/components/profile/`** holds `profile-actions.tsx`, `profile-block.tsx`, `profile-header.tsx`, `profile-info.tsx`, `profile-person.ts`, `profile-view.tsx` and `use-profile-dm.ts`. There's no `profile-media.tsx`.

### Steps
1. **Add `apps/mobile/src/components/profile/profile-media.tsx`:** `export function ProfileMedia({ chatId }: { chatId: string })`.
   - It renders an `InfoRowGroup` with one `InfoRow` (icon `Image` from `lucide-react-native`, label "Shared media") that opens the sheet.
   - It also renders `{open ? <MediaSheet chatId={chatId} onJump={jump} onClose={() => setOpen(false)} /> : null}`.
   - `jump` closes the sheet, then runs the same `openSearchHitEffect` call as group info, with `pushChat` and `pushChatNotFound` going to `/chat/[id]`.
2. **In `app/u/[handle].tsx`:** render `{dmChatId !== undefined ? <ProfileMedia chatId={dmChatId} /> : null}` between `ProfileInfo` and `ProfileBlock`.
3. **No other change, no tests** (UI).

### Allowed files
- `apps/mobile/src/components/profile/profile-media.tsx`
- `apps/mobile/src/app/u/[handle].tsx`
- `work/T-1664-profile-shared-media.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **A contact with a DM shows a "Shared media" row** that opens the DM's media sheet; tapping an item opens the DM at that message.
- **No row without a DM.**

---

## Report (written by the worker when done)

### What I did

- Added `apps/mobile/src/components/profile/profile-media.tsx`: `ProfileMedia({ chatId })` renders an `InfoRowGroup` with one `InfoRow` (lucide `Image`, label "Shared media") that opens the sheet, plus `{open ? <MediaSheet chatId={chatId} onJump={jump} onClose={…} /> : null}`. `jump` closes the sheet and then runs the same `openSearchHitEffect` call as group info, with `pushChat`/`pushChatNotFound` routing to `/chat/[id]`.
- In `apps/mobile/src/app/u/[handle].tsx`: imported `ProfileMedia` and rendered `{dmChatId !== undefined ? <ProfileMedia chatId={dmChatId} /> : null}` between `ProfileInfo` and `ProfileBlock`.
- No other change, no tests (UI).

### Checks run

- `pnpm gate` (repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (1.6s)
  PASS  lint  (1.4s)
  PASS  typecheck  (6.3s)
  PASS  effect  (1.0s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: this is UI code with no tests, and the gate reports no nearby test files for `@zilar/mobile`.

### Notes for the lead

- Changed files: `apps/mobile/src/components/profile/profile-media.tsx` (new), `apps/mobile/src/app/u/[handle].tsx`, `work/T-1664-profile-shared-media.md` — all inside the Allowed files.
- The row is only rendered when `dmChatId !== undefined`, matching the acceptance criterion "no row without a DM".
- `MediaSheet`, `InfoRow`/`InfoRowGroup` and `openSearchHitEffect` are reused as-is from the group-info pattern; no new dependencies.
- I did not run the mobile app; the acceptance (tapping through to a message on a phone) needs the lead's smoke / Julio's live check, as usual for UI.

## Review (written by Claude)

**Approved and merged.** This is parity gap 9.

- **Pre-review:** clean, 0 nits.
- **The change:** `ProfileMedia` (53 lines) is the group-info row-and-sheet pattern for the DM: a "Shared media" row, the existing `MediaSheet`, and a jump through `openSearchHitEffect`. `/u/[handle]` shows it only when a DM exists.
- **Still to check:** the emulator check is in the combined phone QA pass on main.
