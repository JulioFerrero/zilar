---
id: T-0388
title: "Web kit: the voice transcript \"Aa\" toggle becomes a Captions icon on the kit IconButton; the file Retry upload uses IconButton; transcript Retry and Transcribing… use the kit"
status: merged
milestone: M5
branch: task/T-0388-web-voice-file-key-icons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0388: voice and file message key buttons on the kit

## Spec (written by Claude, do not edit)

### Why
- The voice message's transcript toggle shows the text "Aa", and Julio wants icons, not glyphs, in the app.
- These small `key-icon` buttons hand-roll what the kit `IconButton` already does.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/icon-button.tsx`:**
  - `IconButton({ size = 36, radius = 10, className, style, type = 'button', ...props })` renders a `<button>` with `key-icon inline-flex shrink-0 items-center justify-center disabled:…` and an inline `width`/`height`/`borderRadius` from `size`/`radius`;
  - it passes every other prop through (`aria-*`, `onClick`).
- **`apps/web/src/components/ui/button.tsx`:** variants `default`, `outline`, `secondary` (`bg-surface text-secondary-foreground hover:bg-surface-raised`) and `ghost`; size `sm` (h-7).
- **`apps/web/src/components/ui/state-message.tsx`:** `size="inline"` renders a small muted row, and `kind="loading"` adds a spinner and `role="status"`.
- **`apps/web/src/components/VoiceMessage.tsx`:**
  - line 262: `<button type="button" aria-label={transcriptOpen ? 'Hide transcript' : 'Show transcript'} aria-pressed={transcriptOpen} onClick={toggleTranscript} className="key-icon shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold">Aa</button>`;
  - line 274: `<p className="mt-1.5 text-[14px] text-muted-foreground">Transcribing…</p>`;
  - line 284: `<button type="button" onClick={retryTranscript} className="key-icon rounded-md px-1.5 py-0.5 text-[13px] font-medium">Retry</button>`, inside a `<p>` after the error message;
  - line 2 imports `Pause, Play` from lucide, and line 4 imports `Button`.
- **`apps/web/src/components/FileMessage.tsx:51`:**
  - `<button type="button" aria-label="Retry upload" onClick={onRetry} className="key-icon flex size-8 shrink-0 items-center justify-center rounded-[8px]">` with `<RotateCcw className="size-4" aria-hidden="true" />`;
  - leave the Download `<a>` at line 60 alone; it is a link.
- **Tests:**
  - `apps/web/src/components/VoiceMessage.test.tsx` finds the toggle by label "Show transcript" (lines 62-107) and Retry by role and name (line 129);
  - `apps/web/src/components/FileMessage.test.tsx:39` uses the label "Retry upload";
  - `apps/web/src/components/VoiceMessage.player.test.tsx`.

### What to build
1. **Transcript toggle** → `<IconButton size={24} radius={6} aria-label=… aria-pressed={transcriptOpen} onClick={toggleTranscript}><Captions className="size-3.5" aria-hidden="true" /></IconButton>`. Import `Captions` from `lucide-react` and `IconButton` from `@/components/ui/icon-button`.
2. **Transcribing…** → `<div className="mt-1.5"><StateMessage kind="loading" size="inline" title="Transcribing…" /></div>`.
3. **Transcript Retry** → `<Button type="button" variant="secondary" size="sm" onClick={retryTranscript}>Retry</Button>`. Change its `<p>` parent to a `<div className="mt-1.5 flex items-center gap-2 text-[14px]">` so a button is not nested in a `<p>`.
4. **FileMessage Retry upload** → `<IconButton size={32} radius={8} aria-label="Retry upload" onClick={onRetry}>`, keeping the `RotateCcw` icon.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/icon-button.tsx`, `apps/web/src/components/ui/state-message.tsx`, `apps/web/src/components/VoiceMessage.tsx:255-295` and `apps/web/src/components/FileMessage.tsx:45-72`.

### Allowed files
`apps/web/src/components/VoiceMessage.tsx`, `apps/web/src/components/FileMessage.tsx`, `apps/web/src/components/VoiceMessage.test.tsx`, `apps/web/src/components/VoiceMessage.player.test.tsx`, `apps/web/src/components/FileMessage.test.tsx`, `work/T-0388-web-voice-file-key-icons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot VoiceMessage FileMessage
pnpm gate
```

### Acceptance
- No "Aa" text and no `key-icon` class remain in `VoiceMessage.tsx` or `FileMessage.tsx`.
- No hand-rolled `<button` remains in those two files.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Did steps 1-4 of the spec; files changed are inside the Allowed files.

- `apps/web/src/components/VoiceMessage.tsx`:
  - transcript toggle is now `<IconButton size={24} radius={6} aria-label={transcriptOpen ? 'Hide transcript' : 'Show transcript'} aria-pressed={transcriptOpen} onClick={toggleTranscript}><Captions className="size-3.5" aria-hidden="true" /></IconButton>`; removed the `Aa` glyph.
  - "Transcribing…" is now `<div className="mt-1.5"><StateMessage kind="loading" size="inline" title="Transcribing…" /></div>`.
  - transcript Retry is now `<Button type="button" variant="secondary" size="sm" onClick={retryTranscript}>Retry</Button>` inside `<div className="mt-1.5 flex items-center gap-2 text-[14px]">` (was a `<p>`, so the button is no longer nested in a paragraph).
  - imports added: `Captions` (lucide), `IconButton`, `StateMessage`. `Button` was already imported.
- `apps/web/src/components/FileMessage.tsx`: Retry upload is now `<IconButton size={32} radius={8} aria-label="Retry upload" onClick={onRetry}><RotateCcw className="size-4" aria-hidden="true" /></IconButton>`; added `import { IconButton } from '@/components/ui/icon-button'`. The Download `<a>` is untouched per the spec ("leave the Download `<a>` … alone; it is a link").

Acceptance status:
- No `Aa` text and no `<button` in `VoiceMessage.tsx`: yes (grep clean).
- No `<button` in `FileMessage.tsx`: yes.
- **Deviation / conflict to flag:** the acceptance also says "no `key-icon` class remain in `VoiceMessage.tsx` or `FileMessage.tsx`". `VoiceMessage.tsx` is clean, but `FileMessage.tsx:62` still has one `key-icon` on the Download `<a>`, because the spec's "Verified facts" explicitly says to leave it alone (it is a link, not a key button) and `NOW.md` lists only "FileMessage key-icon retry" as still raw. I followed the explicit spec. Removing that class would require either styling the link like a kit button (no kit link/key component exists) or adding a file outside the Allowed files. Question for the lead: if the acceptance bullet is meant literally, say how the Download link should be restyled; otherwise the spec text is authoritative.

Commands (real results):
- `pnpm install --frozen-lockfile`: exit 0 (17.9s).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot VoiceMessage FileMessage`: 3 files, 16 tests passed, exit 0 (the one stderr line "Not implemented: HTMLMediaElement's pause() method" is jsdom noise).
- `pnpm gate` (repo root): `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/web`, `scope: every changed file is inside the Allowed files`, `GATE PASS`. The gate reported 3 changed files against main (the two source files plus this task file).

Security checklist: UI-only change; no secrets/tokens touched or logged; no deletes/updates, caps, uniqueness rules, permission checks, routes, rate limits or audit entries involved.

## Review (written by Claude)

Approved (lead, 2026-10-06). The transcript toggle is a kit IconButton with the lucide Captions icon (no more "Aa"); Transcribing… is an inline StateMessage; transcript Retry is a kit secondary Button outside a `<p>`; file Retry upload is a kit IconButton. The follow-up is my acceptance wording: the Download `<a>` keeps `key-icon`, as the spec said to leave it. Pre-review clean otherwise.
