---
id: T-0452
title: "Audit + plan: lock /upload files behind the session and chat membership (today anyone with a file URL can read it, even after a retraction)"
status: merged
milestone: M5
branch: task/T-0452-upload-auth-audit
model: auto
effort: low
depends_on: []
estimate: 0.4 day
---

# T-0452: plan for locking uploaded files

## Spec (written by Claude, do not edit)

### Why
Julio chose (2026-10-07) to close the open security issue from T-0256:
- `/upload/*` is served with no authentication;
- anyone holding a file URL can read the file;
- that stays true after the message is retracted.

This task **writes the plan only**: no code, no config change. The lead turns the plan into tasks.

### Verified facts (do not re-derive)
- **Uploads use ejabberd's `mod_http_upload` (XEP-0363):**
  - the handler is `/upload: mod_http_upload` (`infra/ejabberd/ejabberd.yml:78`);
  - the module config is at lines 198-205: `max_size: 52428800`, `docroot: /opt/ejabberd/upload`, `put_url`, and CORS `Access-Control-Allow-Origin: '*'`.
- **Serving:**
  - Caddy proxies `/upload/*` straight to ejabberd (`deploy/caddy/Caddyfile:39-44`, as cited in `docs/audit/media-gallery-plan.md:42-52`);
  - the volume is `ejabberd-uploads:/opt/ejabberd/upload` (`infra/docker-compose.dev.yml:78`).
- **The media index** (T-0410, the `mediaItems` table in `apps/server/src/db/schema.ts`) already stores each file URL per chat.
- **Membership** for archives is computed by `allowedArchives` (`apps/server/src/search/service.ts:65`).

### What to produce
**New `docs/audit/upload-auth-plan.md`**, in plain English, citing `file:line` for every claim about the code. It has these sections:
1. **Today.**
   - Every place that creates, stores, sends or loads an upload URL:
     - the web and mobile upload slot requests and PUTs;
     - the `attachment`, `voice` and GIF payloads;
     - `<img>`, `<video>` and `<audio>` sources on web, and `Image` and the voice player on mobile;
     - forwarding re-uploads;
     - `apps/server/src/voice-transcription/routes.ts`;
     - the media indexer;
     - avatars and stickers, if they use it;
     - push previews.
   - How each request authenticates today, if at all. The exact Caddy and ejabberd paths.
2. **Threats.** For each one, who can read what today:
   - a leaked URL;
   - a former member;
   - a retracted message;
   - a forwarded copy;
   - search engines and logs.
3. **Options, compared.** At least:
   - **(a)** a server route, such as `GET /api/files/<path>`, that checks the session (cookie on web, bearer on mobile) and that the caller can see a chat containing that URL (through `mediaItems` and `allowedArchives`). It streams the file, and Caddy stops serving `GET /upload/*` directly but keeps `PUT`.
   - **(b)** short-lived signed URLs minted by the server.
   - **(c)** anything ejabberd offers natively.

   For each option, cover:
   - how web `<img>` and `<video>` load it (same-origin cookies?);
   - how mobile `Image`, `expo-video` and the voice player send the bearer;
   - range requests for audio and video;
   - caching;
   - what breaks for already-sent messages and older clients;
   - the work on the live server, which needs Julio.
4. **Retraction.** How a retracted message's file stops being served, and whether to delete it:
   - who can delete it, given the server does not mount the ejabberd volume today;
   - what happens when the file is also in a forwarded copy.
5. **Recommendation and task split.** Small tasks in order (server, web, mobile, deploy), each with its files and tests. Mark the steps that need Julio, such as the live Caddy change and the volume mount.
6. **Open questions for Julio**, each with a recommended answer.

### Read first
`AGENTS.md`, `docs/audit/media-gallery-plan.md` (the upload flow section), `docs/audit/forwarding-plan.md` (the re-upload path), `infra/ejabberd/ejabberd.yml`, `deploy/caddy/Caddyfile`, `deploy/docker-compose.yml`, `apps/server/src/media/indexer.ts`, `apps/server/src/search/service.ts:55-130`, and the web and mobile upload code (`grep -rn "upload" apps/web/src apps/mobile/src packages/xmpp-core/src`).

### Allowed files
`docs/audit/upload-auth-plan.md`, `work/T-0452-upload-auth-audit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/upload-auth-plan.md` answers sections 1-6, and every code claim has a `file:line` that exists.
- No code or config file changed.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Wrote `docs/audit/upload-auth-plan.md` (docs-only, no code/config changed),
covering all 6 spec sections: Today (serving path, creators, storage, loaders,
auth table), Threats (leaked URL, former member, retraction, forwarded copy,
engines/logs), Options (a: server streams — recommended; b: signed URLs;
c: ejabberd native — not possible), Retraction (serve-while-any-live-row,
refcounted deletion, server lacks the volume mount), task split (6 ordered
tasks), and 6 open questions with recommendations.

Files changed: `docs/audit/upload-auth-plan.md` (new),
`work/T-0452-upload-auth-audit.md` (status + this report only).
Every `file:line` citation was machine-checked to exist (two shell loops,
all passed).

Commands and real results:
- `pnpm install`: done, 12.9s, exit 0.
- Citation checks (2 shell loops over ~45 `file:line`s): all exist, no output.
- No single-file tests run: docs-only task, no code touched.
- `pnpm gate`: GATE PASS — install/format/lint/typecheck all PASS, scope
  check confirms every changed file is inside the Allowed files
  (2 changed files against main).

Deviations: none. Open questions: in section 6 of the plan doc.

## Review (written by Claude)

Approved (lead, 2026-10-07). docs/audit/upload-auth-plan.md maps every upload URL path (slots, payloads, the media index, the web and mobile loaders, voice transcription; avatars, stickers and push are out of scope), the five threats, options (a) server streaming, (b) signed URLs and (c) ejabberd native (no option), retraction with the forwarded-copy rule, a 6-task split marked where Julio is needed, and 6 open questions with recommendations. Nit accepted: the header names the worktree path.
