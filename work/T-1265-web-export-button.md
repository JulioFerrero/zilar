---
id: T-1265
title: "Web: 'Export my messages' in Settings → Profile — fetches the T-1262 export, saves it as zilar-export-<date>.json, and turns 403 reauth_required / 429 / 413 into one clear line each"
status: merged
milestone: M5
branch: task/T-1265-web-export-button
model: auto
effort: default
depends_on: [T-1262]
estimate: 0.2 day
---

# T-1265: Export my messages (web)

## Spec (written by Claude, do not edit)

### Why
T-1262 (merged) added the export: the auth endpoint `export` at `/me/export` (`packages/api-contract/src/auth.ts:171`), which streams JSON with `Content-Disposition: attachment`. Its limits are in `apps/server/src/auth/export.ts`:
- **403 `reauth_required`:** the session is more than 30 minutes old;
- **429:** the user already exported in the last hour;
- **413 `export_too_large`:** over 200,000 messages (`:151`).

Nothing on the web calls it. Settings → Profile is `apps/web/src/components/ProfileSettingsSection.tsx` (299 lines).

### What to build
1. **A new `apps/web/src/components/ExportSection.tsx`,** rendered at the bottom of `ProfileSettingsSection.tsx` (add at most ~3 lines there):
   - title "Export your data";
   - the text "Download your profile, contacts and messages as a JSON file.";
   - an "Export my messages" button (lucide `Download`).
2. **On click,** `fetch('/api/me/export', { credentials: 'include' })`, the same way other raw downloads in `apps/web/src/lib/api.ts` call the server (cite one, or use the shared base URL helper there):
   - **200:** read it as a blob and save it with a temporary `URL.createObjectURL` link, using the filename from `Content-Disposition` (fallback `zilar-export.json`), then revoke the URL. Show "Export downloaded." The button shows "Preparing…" and is disabled while it runs;
   - **403 `reauth_required`:** "For your safety, sign in again to export. Exports need a sign-in from the last 30 minutes.";
   - **429:** "You can export once an hour. Try again later.";
   - **413:** "Your history is too large to export here. Contact the operator.";
   - **anything else:** "Could not export. Try again.".
3. **Mock:** the mock serves `/me/export` (T-1262, `packages/mock-backend/src/domains/me/export.ts`), so the mock flow works.
4. **No tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `work/T-1262-account-export.md`, `apps/server/src/auth/export.ts:1-60`, `apps/web/src/components/ProfileSettingsSection.tsx` and `apps/web/src/lib/api.ts`.

### Allowed files
`apps/web/src/components/ExportSection.tsx`, `apps/web/src/components/ProfileSettingsSection.tsx`, `apps/web/src/lib/api.ts`, `work/T-1265-web-export-button.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:** Profile shows the section, and clicking downloads a JSON file with the plan's keys (`exportedAt`, `profile`, `contacts`, `chats`).

---

## Report (written by the worker when done)

### What I did
- **`apps/web/src/components/ExportSection.tsx`** (new, 113 lines): the "Export your data" block — the sentence, an "Export my messages" button with the lucide `Download` icon, and a status line. On click it runs one Effect through `useAction`: fetch the export, map a refusal to one fixed sentence, else read the blob and save it with a temporary `URL.createObjectURL` link (`link.download` from `Content-Disposition`, falling back to `zilar-export.json`), then revoke the URL. While it runs the button is disabled and shows "Preparing…"; on success it shows "Export downloaded.".
  - Status mapping (fixed sentences of our own, never the server text): `403` → "For your safety, sign in again to export. Exports need a sign-in from the last 30 minutes."; `429` → "You can export once an hour. Try again later."; `413` → "Your history is too large to export here. Contact the operator."; anything else (including a network rejection) → "Could not export. Try again.".
- **`apps/web/src/lib/api.ts`**: added `fetchExport(): Promise<Response>`. The real call is `fetch(`${API_BASE}/me/export`, { credentials: 'include' })`; in web mock mode it dispatches `/me/export` to the mock backend instead, exactly like `request`/`uploadBytes` in `lib/api/http.ts`, so the mock flow works. It only rejects when the server cannot be reached; a refusal is returned as a `Response` for the caller to map.
- **`apps/web/src/components/ProfileSettingsSection.tsx`**: two lines — the import and `<ExportSection />` at the bottom of the section.

### Files changed
`apps/web/src/components/ExportSection.tsx` (new), `apps/web/src/lib/api.ts`, `apps/web/src/components/ProfileSettingsSection.tsx`, `work/T-1265-web-export-button.md`. All are inside the task's Allowed files. Largest touched file: `apps/web/src/lib/api.ts`, 337 lines.

### Commands and results
- `pnpm install` → done, 11.8s (only a pre-existing peer-dependency warning in `apps/mobile`).
- Single test files: **none**. The change is UI only and the task says "No tests (UI)"; the gate reports no nearby web test files, so no per-file test run was meaningful.
- `pnpm gate` (from the repo root), first two runs failed on the Effect ratchet / a type annotation, final run:
```
gate: 4 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (0.4s)
PASS  lint  (0.4s)
PASS  typecheck  (2.5s)
PASS  effect  (0.3s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Deviations / decisions
- **Where the `fetch` lives.** The spec wrote `fetch('/api/me/export', ...)` in the click handler, but the web mock is a JS dispatcher (`isMockApiEnabled()` → `loadMockRequest()`), not a service worker, so a plain `fetch` would bypass the mock and the lead's mock check would hit the real server. I put the request in `fetchExport()` in `lib/api.ts` (an Allowed file) behind the same mock seam every other call in `lib/api/http.ts` uses, keeping `credentials: 'include'` and `API_BASE` as the spec asked. The component then just consumes the `Response`.
- **Effect ratchet.** The gate's `effect` step rejects new `async`/`fetch`/`try` in a plain file, so `ExportSection.tsx` runs its action through `useAction` with an `Effect` (the codebase pattern) and `api.ts` builds the request as an `Effect` run with `runWeb`. The component no longer has `async`/`await`/`try`.
- **403 by status.** Any `403` maps to the reauth sentence (T-1262's only 403 on this route is `reauth_required`); I did not parse the error body.
- **Filename.** The `Content-Disposition` name is used as-is after stripping any path; the mock sends no such header, so the mock download uses the `zilar-export.json` fallback (still a JSON file with the plan's keys).

### Not verified by me
- I did not run the web app in a browser, so I did not click the button against the mock myself; the acceptance check ("clicking downloads a JSON file with the plan's keys") is the lead's smoke test. What I verified is static: the gate passes, and the mock route `/me/export` exists and returns the §6a document (`packages/mock-backend/src/domains/me/export.ts`,
  `apps/web/src/mock/backend.ts` dispatch).

### Blocked / needs a decision
None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (1 nit).**
- **The change:** a new `ExportSection.tsx` (113 lines) under Profile, with the fetch and status mapping in `api.ts`.
- **Lead's check on the local web mock:**
  - the "Export your data" section shows with its text and the "Export my messages" button;
  - clicking it saved `zilar-export.json` (the mock sends no `Content-Disposition`, so the fallback name is used; the server sends `zilar-export-<date>.json`);
  - the blob parsed to the keys `exportedAt`, `profile`, `contacts` and `chats`, and the line "Export downloaded." showed.
- **Not checked:** the error lines for 403/429/413; the mock doesn't produce them. They're covered by the code's status mapping.
