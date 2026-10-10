---
id: T-1082
title: "Audit: rewrite docs/audit/mock-sweep-status.md for main after T-1081, with what is left of the mock plan and a fix plan for blank sticker, GIF and attachment images"
status: merged
milestone: M5
branch: task/T-1082-mock-sweep-status-2
model: auto
effort: default
depends_on: [T-1080]
estimate: 0.25 day
---

# T-1082: Mock sweep status, round 2 (audit, docs only)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-sweep-status.md` (T-1059, 283 lines) describes main before T-1060 to T-1080. Since then:
- **web:** `apps/web/src/mock/` has only `backend.ts`, `gate.ts`, `gate.test.ts`, `helpers.ts`, `ids.ts` and `load.ts`. `dispatch` is backend-only (T-1074);
- **mobile:** the hooks run on `mockFetch`. The old `mock/index` chain and the profile, contacts, directory, search, integrations and stickers mocks are deleted.

The lead's grep on main (2026-10-11) shows what is still imported:
- **mobile `mock/gifs.ts`** (43 lines): by `components/chat/composer-sheet.ts`, `components/chat/chat-composer-dock.tsx`, `lib/gifs-api.ts` and `lib/gif-downloader.ts`;
- **mobile `mock/stickers.ts`** (51 lines): by `app/settings/sticker-pack.tsx`, `components/chat/chat-composer-dock.tsx`, `lib/stickers-storage.ts` and `lib/stickers-api.ts`;
- **mobile `mock/attachments.ts`** (39 lines): by `components/chat/chat-composer-dock.tsx`, `lib/attachment-opener.ts`, `lib/attachment-picker.ts`, `lib/attachment-ports.ts`, `lib/voice-playback.ts` and `lib/gif-downloader.ts`;
- **web `mock/helpers.ts`:** `mockGifItems` for `components/StickerPanel.tsx:14`; **web `mock/ids.ts`:** for `auth/AuthProvider.tsx:9`.

The BOARD has an open follow-up: sticker, GIF and attachment images are blank in mock mode on both apps.
- **web:** `<img src="/api/stickers/<id>/file">` goes to vite and gets a 404. `apps/web/src/lib/stickers.ts:95-125` shows only same-origin `/api/stickers/:id/file` urls, on purpose;
- **mobile:** native `Image` fetches from `API_URL` and never reaches `mockFetch`, and the seed art is SVG;
- **attachments:** the fake slot `getUrl` is a `data:` url (`packages/mock-backend/src/xmpp/core.ts:229`), which reads "Not loaded: untrusted address".

### What to build
Rewrite `docs/audit/mock-sweep-status.md` for main as of this task's base. It is a doc only, at most 300 lines, with every claim as `file:line`. Sections:
1. **What is left in each app's `mock/` folder.** For each file: line count, every importer (`grep -rn`, including `require(` forms), what it provides, and whether the shared backend could provide it instead.
2. **Remaining old-mock behaviour, per screen.** Anything a screen still gets from a local mock rather than from `@zilar/mock-backend`.
3. **The blank images.** For stickers, GIFs and attachments, on web and on mobile:
   - the exact load path today, from the url to the element;
   - why it fails;
   - one or two concrete fixes. Candidates:
     - a vite dev middleware that answers `/api/stickers/:id/file`, `/api/gifs/media/...` and `/api/avatars/...` from the shared backend in mock mode;
     - raster (PNG) seed art;
     - a mock-only url allowance.

     For each fix: the files it touches, and whether it changes any production code path. The same-origin sticker check must stay in production.
4. **Proposed slices,** each at most about 800 changed lines, in order, with their Allowed files as full repo paths.
5. **Doc fixes:** the lines in `docs/audit/mock-plan.md` that are now wrong, listed and not edited.

Do not change code. Do not run the apps.

### Read first
`AGENTS.md`, `docs/audit/mock-sweep-status.md`, `docs/audit/mock-plan.md`, `apps/web/src/mock/`, `apps/mobile/src/mock/`, `apps/web/src/lib/stickers.ts`, `apps/mobile/src/lib/gifs-api.ts`, `packages/mock-backend/src/xmpp/core.ts`, and `packages/mock-backend/src/domains/stickers/`.

### Allowed files
`docs/audit/mock-sweep-status.md`, `work/T-1082-mock-sweep-status-2.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The doc has the 5 sections, and every claim cites `file:line`.

---

## Report (written by the worker when done)

### What I did

Rewrote `docs/audit/mock-sweep-status.md` (283 lines before, 230 now) for the
branch base as of 2026-10-11, with the 5 required sections and every claim
carrying a `file:line`. Doc only; no code changed and no app was run.

- §1 lists the 6 remaining web and 10 remaining mobile `mock/` files with line
  count, importers, what each provides and whether the shared backend could serve
  it.
- §2 lists the per-screen local-mock reads left on each app.
- §3 traces the blank stickers/GIFs/attachments from url to element, the reason
  each fails, and one or two fixes per item, naming touched files and whether a
  production path changes (the same-origin sticker check and
  `isTrustedMediaUrl` stay in production).
- §4 lists 4 ordered slices, each ≤ ~800 changed lines, with full-repo-path
  Allowed files.
- §5 lists the now-wrong lines in `docs/audit/mock-plan.md` (not edited).

### Files changed

- `docs/audit/mock-sweep-status.md` (rewritten).
- `work/T-1082-mock-sweep-status-2.md` (report and status only).

### Commands

- `pnpm install` — done, 15 workspace projects, 11.8s.
- `pnpm gate` (repo root) — summary lines:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (2.2s)`
  - `PASS  format  (1.5s)`
  - `PASS  lint  (0.9s)`
  - `PASS  typecheck  (1.4s)`
  - `SKIP effect (no source files changed)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
  No test file was run separately: no package code changed, so no nearest test
  existed.

### Deviations from the spec

- The task's importer list for mobile `mock/{gifs,stickers,attachments}` is not
  what `grep -rn` returns on this base. `lib/gifs-api.ts`, `lib/gif-downloader.ts`,
  `lib/stickers-api.ts`, `lib/stickers-storage.ts`, `lib/attachment-*.ts` and
  `lib/voice-playback.ts` import `./gifs` etc., which resolve inside
  `apps/mobile/src/lib/`, not `mock/`; and `app/settings/sticker-pack.tsx:16`
  imports `./stickers` = `app/settings/stickers.ts`. The only importers of the
  mock demo files are `components/chat/composer-sheet.ts:23` and
  `components/chat/chat-composer-dock.tsx:9-11`. I documented the actual grep
  result and flagged the correction in the doc (§1 note).
- Also found dead code the spec did not mention: `apps/mobile/src/mock/drafts.ts`
  (62 lines), `apps/mobile/src/mock/load.ts` (26 lines) and all of
  `apps/web/src/mock/ids.ts` except `currentUserId` have no importers.
- §3.2 records that web GIF placeholders are inline `data:` SVG in `<img>` and
  are **not** blank today, unlike stickers; the BOARD's "GIF blank" applies to
  mobile (SVG in native `Image`/`expo-image`).

### Blocked / needs a decision

None.

### Open questions

- §3.5 proposes two attachment fixes (a shared-backend `files` domain vs. the
  mobile local uri). If the lead has a preference, the slice list in §4 can be
  narrowed accordingly.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** `docs/audit/mock-sweep-status.md` is rewritten for main (230 lines).
  - **§1:** the 6 web and 10 mobile mock files, with their importers;
  - **§2:** the remaining local-mock behaviour: the web GIF tab, the web session, and the mobile composer demo packs, GIFs and attachments;
  - **§3:** the load path and the cause of each blank image;
  - **§4:** four slices: the web dev middleware, raster seed art, a mock-gated mobile image allowance, and attachment bytes;
  - **§5:** the stale lines in `mock-plan.md`.
- **The lead read §2-§4.** Before speccing any slice, the lead re-checks its `file:line` citations on main.
- **Check:** the gate passed.
