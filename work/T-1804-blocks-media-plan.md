---
id: T-1804
title: "Plan only: media kinds for AI cards (20 images, 24 file, 21 place map) — how an AI turns a web image or a generated file into an uploaded media id a block can carry, how clients draw it, and the security limits; write docs/plan/message-blocks-media.md with ordered tasks"
status: merged
milestone: M5
branch: task/T-1804-blocks-media-plan
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1804: Plan for media in AI cards

## Spec (written by Claude, do not edit)

### Why
Julio approved 25 native card blocks (`docs/plan/message-blocks.md`). Every data, progress, chart and content kind works today except the media ones:
- 20 `images`;
- 24 `file`;
- the map on 21 `place`.

The design says media blocks carry **uploaded media ids, never URLs** (`docs/plan/message-blocks.md:204-212` and `:450-452`). There's no path yet for an AI to get such an id. This task writes the plan only. **No source file changes.**

### Facts (read by the lead on 2026-10-17)
- **The plan's rows:**
  - `docs/plan/message-blocks.md:204`: `images`, `items[]` 1–4 × `IdSchema` (uploaded media ids), `extra?`;
  - `:208`: `file`, `media` IdSchema, `name`, `size`, `kind`, `rows?`;
  - `:210-212`: renderers resolve ids against the API origin.
- **`IdSchema`** is `packages/protocol/src/common.ts:66-72`.
- **Server modules to read:**
  - `apps/server/src/files/` (`api.ts`, `internal-fetch.ts`): the file proxy;
  - `apps/server/src/media/` (`api.ts`, `items.ts`, `rows.ts`, `indexer.ts`): the media gallery index.
- **How people attach files:** the `attachment` payload (search `packages/protocol/src` and `packages/client-core/src/store/send/attachment.ts`).
- **How AIs reach the web:**
  - the keyless `web.*` actions and sandbox tools (`apps/server/src/agents/tool-guide.ts:17-35`);
  - the desk computer and egress (`apps/server/src/agents/gateway/tool-exec.ts`, desk tools).

### Steps
1. **Read** the files above and find the real upload path for people's media: where bytes go, how they're named, and how clients fetch them. Cite `file:line` for every claim.
2. **Write `docs/plan/message-blocks-media.md`:**
   1. **Today:** how a person's image or file is uploaded and served, and what id a client holds.
   2. **AI-side options** for getting media into that store, with costs, risks and a **recommendation**:
      - a server action that fetches one image by https URL through the existing egress or safe fetch, checks the type and size, stores it, and returns a media id;
      - a sandbox tool returning bytes;
      - a desk file;
      - a generated chart image.
   3. **The id format** a block carries, and how web and phone resolve it (auth, cache, size variants).
   4. **Security:**
      - SSRF (no private IPs; reuse the existing guard if there is one);
      - MIME sniffing and allowed types;
      - size caps and a per-AI quota;
      - EXIF stripping;
      - who may read the media (room members only);
      - logging rules (ids only).
   5. **The place map:** whether to keep "no map" (the guide says `place` (no map)) or add a static map image, and from which provider (cost, key needs). Recommend one.
   6. **Ordered tasks:** each one worker, at most 400 lines per file, server first, then web and phone twins, then the guide. Give each its files and the 0–2 tests it needs (only auth, permissions or the message pipeline).
   7. **Open questions for Julio,** with a recommended answer each.
3. **Don't change any source file.**

### Allowed files
- `docs/plan/message-blocks-media.md`
- `work/T-1804-blocks-media-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The plan doc exists, cites `file:line` for every fact, recommends one approach, and lists ordered tasks and open questions.
- No source changes.

---

## Report (written by the worker when done)

### What I did

Wrote `docs/plan/message-blocks-media.md` after reading the real upload, proxy
and gallery code. No source file was changed.

The plan covers, with `file:line` citations:

- **Today.** A person's image/file goes from the composer to a XEP-0363 slot,
  the bytes live in ejabberd's upload docroot, the payload carries the download
  URL, and clients load same-origin files through `GET /api/files`
  (`apps/server/src/files/api.ts`), which checks the session, a 600/min limiter
  and chat membership. The gallery's `media_items.id` exists but is never used
  to fetch bytes (`apps/server/src/media/rows.ts:42-64`).
- **AI-side options.** Compared the four options from the spec and recommended
  one: a native `fetch_media` tool (same offer/dispatch path as `post_blocks`)
  that fetches through the existing SSRF guard (`guardedGet`), sniffs magic
  bytes, strips EXIF and stores the bytes in a new server-owned
  `card_media` store, returning a `randomUUID` id. The sandbox-tool and desk-file
  paths were rejected on 8 KiB model caps and the lack of a binary channel; a
  generated chart image was rejected in favour of the existing native chart
  kinds. A small `save_text_media` is proposed for text files the model
  generates.
- **The id and clients.** `randomUUID()` fits `IdSchema`
  (`packages/protocol/src/common.ts:66-72`); clients resolve
  `/api/card-media/:id` (relative on web, absolute + bearer on phone through
  `useMediaSource`), with no size variants in v1 and a fixed-tile renderer.
- **Security.** Reuse of the existing SSRF guard (https, 443, no redirects, DNS
  pin, private addresses refused), magic-byte MIME sniffing, per-kind size and
  pixel caps, a per-AI quota under a Postgres advisory lock, EXIF/metadata
  stripping before the id exists, room-members-only reads with the same 404 for
  unknown and invisible, and ids-only logging.
- **The place map.** Recommended keeping "no map" in v1 (the guide and both
  renderers already do), with the provider/geocoder decision deferred to a
  separate task if Julio wants maps later.
- **Ordered tasks.** Nine tasks: M1 store + migration, M2 read route, M3
  `fetch_media`, M4 media-id validation in the block paths, M5 text-file tool,
  W1 web renderers, P1 phone twins, D1 deploy/docs, G1 guide last. Each lists its
  files, its 0–1 test (only where auth, permissions or the message pipeline is
  touched) and an estimate.
- **Open questions.** Eight, each with a recommended answer.

Files changed:
- `docs/plan/message-blocks-media.md` (new)
- `work/T-1804-blocks-media-plan.md` (status + this Report)

### Checks run

- `pnpm install --frozen-lockfile` — `Done in 13.4s using pnpm v10.32.1`.
- `pnpm gate` — tail:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.0s)
  PASS  lint  (0.8s)
  PASS  typecheck  (0.9s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No package test was run: the task changes only Markdown, and `pnpm gate`
  reported `SKIP effect (no source files changed)`; there is no test near a doc.

### Notes for the lead

- The doc is a plan, so the recommended file paths inside it
  (`apps/server/src/card-media/*`, `apps/server/drizzle/0072_card-media.sql`,
  `ImagesBlock.tsx`, etc.) do not exist yet; they are the task outputs.
- One spec correction found while reading: the real `file` block field is
  `format`, not the `kind` named in `docs/plan/message-blocks.md:208`
  (`packages/protocol/src/blocks-content.ts:74-83`). The plan uses `format`.
- The biggest decision in §7 is storage: I recommend a server-owned store over
  the XEP-0363 upload store because ejabberd trims each user's oldest uploads
  past the hard quota (`deploy/ejabberd/ejabberd.yml:194-197`), which would make
  old cards lose their images. If Julio prefers reusing the existing upload
  store, M1/M2 change but M3's guard/sniff/strip steps stay.
- No source changes, no new dependency, no secret read or printed.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `fffd91908`. The plan cites `file:line` throughout.
- **It recommends:**
  - a native `fetch_media` tool into a server-owned card media store (reusing `guardedGet`, byte sniffing, EXIF stripping and the avatar storage patterns);
  - a session-plus-room read route;
  - no map in v1.
- It orders the tasks M1–M5, W1, P1, D1 and G1.
- **The lead corrected open question 8:** the image and file boards do exist (`WebContent.dc.html:86,123`).
- **Questions 1–7 wait for Julio:** a new storage volume is an infra change, plus approval, quotas and retention. No media task launches before his answers.

