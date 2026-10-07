# Locking uploaded files behind the session and chat membership — audit and plan (T-0452)

Docs-only. No code, config, schema or package changes. Every claim about today's
code carries a `file:line`. Line numbers are from the worktree at
`/Users/julio/personal-projects/zilar-T-0452` on branch
`task/T-0452-upload-auth-audit` on 2026-10-07.

Task: `work/T-0452-upload-auth-audit.md`. Julio chose (2026-10-07) to close the
open security issue from T-0256: `/upload/*` is served with no authentication,
anyone holding a file URL can read the file, and that stays true after the
message is retracted.

Related plans: the media gallery (`docs/audit/media-gallery-plan.md`), which
assumes bytes stay public (1c there), and forwarding
(`docs/audit/forwarding-plan.md` §1.3), which reuses source URLs as-is because
no per-chat ACL exists today.

---

## 1. Today

### 1a. Serving path: Caddy and ejabberd

- ejabberd registers the XEP-0363 handler at `/upload` (`infra/ejabberd/ejabberd.yml:78`).
- `mod_http_upload` config (`infra/ejabberd/ejabberd.yml:198-205`):
  `max_size: 52428800` (50 MiB), `docroot: /opt/ejabberd/upload`,
  `put_url: 'http://@HOST@:5280/upload'`, and CORS
  `Access-Control-Allow-Origin: '*'` with `GET,HEAD,PUT,OPTIONS`.
- No `access:` rule on the module (lines 198-205 set none), so ejabberd serves
  every GET itself without asking who the caller is.
- Caddy proxies `/upload/*` straight to ejabberd with no strip and no auth
  (`deploy/caddy/Caddyfile:39-44`); the comment there says the path must arrive
  intact because slot URLs look like `https://<domain>/upload/<slot>/<file>`.
- Dev volume: `ejabberd-uploads:/opt/ejabberd/upload`
  (`infra/docker-compose.dev.yml:78`, declared at line 129). Production volume:
  `ejabberd-uploads:/opt/ejabberd/upload` (`deploy/docker-compose.yml:94-96`).
- The server does **not** mount the upload volume: the `server` service in
  `deploy/docker-compose.yml:211-213` mounts only `sticker-data` and
  `avatar-data`, never `ejabberd-uploads`.
- Slot issue is XMPP-authenticated (the client asks `upload.<domain>` over its
  own session, `packages/xmpp-core/src/client.ts:1049-1081`; slot shape
  `putUrl`/`getUrl` in `packages/xmpp-core/src/types.ts:225-230`, parsed at
  `packages/xmpp-core/src/stanza.ts:414-430`). Only the PUT side is gated, by
  the XMPP session; the GET side is open to the world.

### 1b. Who creates upload URLs

- **Web upload:** `uploadAttachment` asks for a slot via
  `requester.requestUploadSlot`, PUTs the bytes to `slot.putUrl`, and returns
  `slot.getUrl` as the message URL (`apps/web/src/lib/attachments.ts:203-235`).
  The store calls it through `attachmentPort.upload`
  (`apps/web/src/store/realStore.ts:1766-1768`). Client-side cap 50 MiB
  (`apps/web/src/lib/attachments.ts:4`, cited in the media plan §1a).
- **Mobile upload:** the native uploader PUTs the local file to `slot.putUrl`
  with `UploadType.BINARY_CONTENT`
  (`apps/mobile/src/lib/attachment-native.ts:220-247`); a refused PUT throws.
- **Voice notes:** web converts server-side via `POST /api/voice`
  (`apps/web/src/lib/voice.ts:198-222`), then PUTs the converted bytes to the
  slot (`apps/web/src/lib/voice.ts:242-268`); mobile does the same through
  `POST /api/voice` plus an XEP-0363 upload (`apps/mobile/src/lib/voice.ts:5`,
  `:224-256`). The voice payload's optional `url` is the download URL
  (`packages/protocol/src/voice.ts:11-18`).
- **GIFs:** not a payload kind — the composer fetches the proxied blob and
  re-uploads it through the attachment path with a `gif-` name
  (`apps/web/src/components/Composer.tsx:445-476`; mobile
  `apps/mobile/src/lib/attachment-native.ts:338-342`).

### 1c. Where upload URLs are stored and sent

- **Wire payloads:** `attachment` (`packages/protocol/src/attachment.ts:10-22`,
  bytes URL at line 13), `voice` (optional `url`,
  `packages/protocol/src/voice.ts:11-18`).
- **Media index (T-0410):** the indexer extracts attachment/voice URLs and link
  URLs from MAM rows into `mediaItems`
  (`apps/server/src/media/indexer.ts:178-218`), with identity
  `(archiveOwner, chatJid, messageId, kind, ref)`
  (`apps/server/src/media/indexer.ts:262-276`). Schema at
  `apps/server/src/db/schema.ts:1231-1276` (`mediaIndexState` at lines 1276+).
- **Voice transcripts:** keyed by URL hash only, no chat id
  (`apps/server/src/voice-transcription/routes.ts:150-151,236-260`).
- **Forwarding re-uploads:** none — a forward reuses the source URL as-is
  (`docs/audit/forwarding-plan.md:199-209`). Locking bytes therefore changes
  what a forwarded copy can load (see §3 and §5).

### 1d. Where upload URLs are loaded

- **Web:** `MessageBubble` renders `ImageMessage`
  (`apps/web/src/components/MessageBubble.tsx:545-563`), `FileMessage`
  (`apps/web/src/components/MessageBubble.tsx:602`), `GifMessage` (a `<video>`,
  `apps/web/src/components/MessageBubble.tsx:622`,
  `apps/web/src/components/GifMessage.tsx:34`), and `VoiceMessage` (an
  `<audio src={voice.url}>`, `apps/web/src/components/VoiceMessage.tsx:208-210`).
  Images auto-load only from trusted hosts (`apps/web/src/lib/attachments.ts:99-134`).
- **Mobile:** `AttachmentImage` auto-loads trusted URLs through `expo-image`
  (`apps/mobile/src/components/chat/attachment-message.tsx:61-144`), video
  through `expo-video` (`apps/mobile/src/components/chat/attachment-video.tsx:82-175`),
  voice through a shared `expo-audio` player whose source is `{ uri, headers }`
  (`apps/mobile/src/components/chat/voice-player.ts:29-63`).
- **Media gallery:** serves URLs from the index; the client loads them the same
  way as message bubbles (no separate auth today).
- **Voice transcription:** the server fetches the audio from ejabberd itself
  (`apps/server/src/voice-transcription/routes.ts:171-229`,
  `toInternalUploadUrl` at line 229) — a server-side fetch that keeps working
  regardless of client-facing auth.
- **Avatars and stickers do NOT use `/upload`:** avatars are served by the
  server at `GET /avatars/:id` (`apps/server/src/avatars/routes.ts:141`) from
  its own volume; stickers at `GET /stickers/:stickerId/file`
  (`apps/server/src/stickers/routes.ts:414`) from `STICKER_STORAGE_DIR`
  (`deploy/docker-compose.yml:143`). Both already pass through server auth and
  are out of scope.
- **Push previews:** the push component resolves text from the archive itself
  (`apps/server/src/push/service.ts:296-345`); `mod_push` sends no body
  (`infra/ejabberd/ejabberd.yml:216-218`), and the payload builder carries no
  message text or URLs (`apps/server/src/push/service.ts:77-85`). Push carries
  no file URLs today, so locking bytes changes nothing there.

### 1e. How each request authenticates today

| Request | Auth today |
| --- | --- |
| Slot request (XEP-0363) | XMPP session (SASL/JWT) |
| PUT bytes to slot URL | Slot secret in the URL path (unguessable, single-use-ish) |
| GET `/upload/*` (any client, any `<img>`/player) | None — Caddy forwards with no auth, ejabberd has no access rule |
| `POST /api/voice`, `POST /api/voice/transcript` | Server session (`requireSession`; voice routes at `apps/server/src/voice-transcription/routes.ts:199-206`) |
| Avatars, stickers, GIF proxy | Server session routes (out of scope, already gated) |

---

## 2. Threats: who can read what today

- **A leaked URL.** Anyone with the URL fetches the bytes, no session, no
  membership, forever (or until quota deletion). The URL is a bearer
  capability (§1a). Leaks via forwarded messages, screenshots of links, logs,
  or chat exports.
- **A former member.** Keeps every URL seen while a member; they keep working
  after leaving or being removed. Membership is checked at MAM-read time
  (search's `allowedArchives`, `apps/server/src/search/service.ts:65-111`) but
  never at download time.
- **A retracted message.** The indexer marks rows deleted
  (`apps/server/src/media/indexer.ts:362-376`), and search hides retractions,
  but the bytes stay on disk and the URL keeps serving. Same for edits that
  remove an attachment: the old URL still resolves.
- **A forwarded copy.** The forward carries the same source URL
  (`docs/audit/forwarding-plan.md:199`), so members of the target chat — who
  were never members of the source — can load source-chat bytes. No copy, no
  new ACL; one URL serves both chats.
- **Search engines and logs.** Slot URLs are random and unlinked, so crawlers
  cannot discover them — but any URL that lands in a log (Caddy access logs,
  error reports, push-provider payloads if that ever changes), a pasted message
  outside Zilar, or a `Referer` header sent when a client fetches a third-party
  asset works for anyone. `Access-Control-Allow-Origin: '*'`
  (`infra/ejabberd/ejabberd.yml:202-205`) additionally lets any website fetch
  a known URL from a visitor's browser.

---

## 3. Options, compared

### (a) Server route `GET /api/files/<path>` that checks session + membership and streams bytes; Caddy stops serving `GET /upload/*` directly but keeps `PUT`

How it works: Caddy routes `GET /upload/*` (or the whole prefix) to the server
instead of ejabberd; PUT/HEAD/OPTIONS stay on ejabberd so uploads keep working.
The server route does `requireSession`, looks up the URL in `mediaItems`,
resolves the chat(s) containing it through `allowedArchives` +
`resolveChatFilter` (`apps/server/src/search/service.ts:65-130`), and streams
the bytes (from a newly mounted read of the upload volume, or by proxying
ejabberd internally). Unknown URL and not-a-member both answer 404 (same
discipline as search, `apps/server/src/search/routes.ts:327-332`).

- **Web `<img>`/`<video>`:** same-origin (`/api/*` already same-origin,
  `deploy/caddy/Caddyfile:20-23`), so session cookies ride automatically —
  `<img src="/api/files/...">` just works, including inside the existing
  trusted-host logic.
- **Mobile `Image`, `expo-video`, voice player:** the bearer must be attached
  manually. `expo-image` takes headers in the source; `expo-video`/`expo-audio`
  accept a headers map (the voice host already models
  `{ uri, headers }`, `apps/mobile/src/components/chat/voice-player.ts:29`).
  Every load site needs the token plumbed in, plus refresh when the session
  rotates. More work than web, but the seams exist.
- **Range requests:** audio/video scrubbing needs `Range`/`206`. The route must
  parse `Range` and forward it to the file read (or to ejabberd when proxying),
  preserving `Accept-Ranges`, `Content-Range`, `Content-Length`. A naive
  whole-file stream breaks scrubbing and wastes data on mobile.
- **Caching:** authenticated responses must use `Cache-Control: private`
  (shared caches must not store them); ETag/`If-None-Match` still allows
  client-side revalidation. CDN caching is effectively off for bytes.
- **Already-sent messages / older clients:** old message payloads carry
  `https://<domain>/upload/...` URLs. Either keep those URLs working (Caddy
  redirects old GETs to the new route, or the route also matches `/upload/*`),
  or rewrite on read. Redirect keeps old clients working only if they follow
  redirects with auth — `<img>` does for same-origin cookies; mobile native
  loaders need checking per library. A client that cannot send auth with the
  media request breaks until updated: this is a breaking change for old mobile
  builds.
- **Live-server work (needs Julio):** Caddy change + reload, mount the upload
  volume into the server container (read-only), and the server now pays
  egress CPU for every byte. Also quota interplay: none — ejabberd still owns
  deletion.

### (b) Short-lived signed URLs minted by the server

How it works: clients keep loading bytes from ejabberd/Caddy directly, but the
URL carries an expiry + HMAC (e.g. `/upload/<slot>/<file>?exp=...&sig=...`).
The server mints the signed URL after the same session + `mediaItems` +
`allowedArchives` check; ejabberd (via a plugin/`auth` callout) or a Caddy
`forward_auth` sidecar verifies the signature and expiry. Fresh URLs are minted
per gallery/message load; messages store the unsigned canonical URL.

- **Web `<img>`/`<video>`:** trivial — the `src` is just a URL with a query
  string; cookies not needed. Range requests pass through untouched since
  ejabberd still serves bytes.
- **Mobile:** equally trivial — signed URL goes straight into `expo-image` /
  `expo-video` / audio source, no header plumbing, no token refresh logic.
- **Range requests:** free (byte path unchanged).
- **Caching:** signed URLs differ per mint, so cache keys churn; use long-ish
  TTLs (e.g. hours) to keep client caching useful, at the cost of a wider leak
  window. `Cache-Control: private` still required.
- **Already-sent / older clients:** old payloads hold unsigned URLs, which
  stop working the moment verification turns on — every client must resolve
  URLs through the minter first. Needs a compat window (accept unsigned during
  rollout, then enforce) or a Caddy redirect of unsigned GETs to the minter.
- **Live-server work (needs Julio):** whichever verifier is chosen must be
  installed in front of ejabberd (Caddy plugin/sidecar or ejabberd module +
  shared HMAC secret rotation). Secret rotation and clock skew are new ops
  surface. No volume mount needed — bytes never flow through the server.

### (c) Anything ejabberd offers natively

ejabberd's `mod_http_upload` in this deployment has no `access:` rule
(`infra/ejabberd/ejabberd.yml:198-205`), and upstream `mod_http_upload` has no
per-request chat-membership check — it knows XMPP users, not Zilar chats, and
the GET path carries no credentials at all (plain GET, no SASL). Native
knobs that exist: `access`/`mod_http_upload` auth for slot creation only, and
quota modules. None gates GET by "member of the chat that contains this URL",
because that mapping lives in our `mediaItems` + `allowedArchives`, which
ejabberd cannot read. Verdict: no native option closes the issue; at most
ejabberd plays the verifier role inside option (b) via a custom module, which
is more code in a less familiar language/runtime than our server.

### Comparison summary

| | (a) server streams | (b) signed URLs | (c) ejabberd native |
| --- | --- | --- | --- |
| Membership check | yes, in our code | yes, at mint time | not possible |
| Web cost | small (cookies automatic) | small (URL swap) | n/a |
| Mobile cost | medium (header plumbing everywhere) | small (URL swap) | n/a |
| Range support | must implement | free | free |
| Server egress | all bytes via Node | none | none |
| Old clients | break unless redirect + auth-following | break unless compat window | n/a |
| Ops | volume mount + Caddy route | verifier + secret rotation | custom module |

---

## 4. Retraction: how a retracted file stops being served

- **Serving check, not deletion, is the fix.** With (a), the route looks up the
  URL in `mediaItems` and refuses when every containing row is `deleted`
  (retraction already marks rows, `apps/server/src/media/indexer.ts:362-376`).
  With (b), the minter refuses to sign a fully-retracted URL. In both cases
  the bytes may remain on disk; they just stop being reachable through any
  fresh check.
- **Who can delete bytes:** nobody today — the server does not mount the
  upload volume (`deploy/docker-compose.yml:211-213`), and ejabberd exposes no
  delete API for served files. Deletion needs: (1) Julio mounts
  `ejabberd-uploads` into the server container (read-write, or a sidecar with
  write access); (2) a server job deletes files whose `mediaItems` rows are
  all `deleted` (and old enough — a grace period covers undo/restore races).
  Deletion is best-effort hygiene, not the security boundary: the 404 is the
  boundary, because a leaked copy of the bytes (or a signed URL minted before
  retraction, under (b)) is out of our hands either way.
- **Forwarded copies:** a forward reuses the source URL, so one `mediaItems`
  row set spans two chats. The rule must be "serve while ANY non-deleted,
  visible-to-caller row references the URL; 404 only when all are deleted or
  none is visible to the caller". Retracting the original hides the file from
  the source chat but the forwarded copy in the target chat keeps loading —
  which matches user expectation (the forward is its own message; retracting it
  hides it there). Bulk-deleting bytes requires refcounting URLs across chats:
  delete only when no non-deleted row references the URL anywhere.

---

## 5. Recommendation and task split

**Recommend option (a)** — the server streaming route — as the first step,
because the membership logic (`allowedArchives`, `resolveChatFilter`) already
exists in our codebase, there is no new crypto/secret surface, and web works
with zero credential plumbing. Accept the egress cost (self-hosted, single
tenant per install) and implement `Range` from day one. Revisit (b) only if
server egress becomes a measured problem.

Ordered tasks (each one PR; server first, then clients, then deploy):

1. **Server: `GET /api/files/...` route + lookup.**
   Files: `apps/server/src/files/routes.ts` (new), `apps/server/src/files/service.ts`
   (new, URL→chats→`allowedArchives` check), `apps/server/src/app.ts` (mount),
   tests beside each. Tests: 401 without session; unknown URL and
   not-a-member both 404; member streams bytes; retracted-only URL 404s;
   forwarded-copy URL serves for target members; `Range` partial content.
2. **Server: volume read + Caddy wiring (needs Julio).**
   Files: `deploy/docker-compose.yml` (read-only `ejabberd-uploads` mount into
   `server`), `deploy/caddy/Caddyfile` (`GET /upload/*` → server, PUT stays on
   ejabberd). Test: deploy smoke check, not unit.
3. **Web: load media through the route.**
   Files: `apps/web/src/lib/attachments.ts` (URL mapping helper),
   `apps/web/src/components/MessageBubble.tsx` (pass mapped URLs),
   `apps/web/src/components/ImageMessage.tsx`, `FileMessage.tsx`,
   `GifMessage.tsx`, `VoiceMessage.tsx` (use mapped `src`), plus tests.
   Same-origin cookies cover auth; keep the trusted-host checks.
4. **Mobile: bearer on every media load.**
   Files: `apps/mobile/src/lib/media-url.ts` (new mapper + header helper),
   `apps/mobile/src/components/chat/attachment-message.tsx`,
   `apps/mobile/src/components/chat/attachment-video.tsx`,
   `apps/mobile/src/components/chat/voice-player.ts` (attach bearer/headers),
   plus tests. Resolve session token per request; handle rotation.
5. **Retraction + forwarded-copy semantics + deletion job (needs Julio for the write mount).**
   Files: server files-job (new), `mediaItems` lookup reuse. Tests: retract
   original → source 404s, forward still serves; retract both → 404
   everywhere; grace-period deletion only when no live row references the URL.
6. **Cutover (needs Julio).**
   Flip Caddy so unsigned `GET /upload/*` no longer reaches ejabberd;
   announce the breaking change for old mobile builds; keep a redirect
   (Caddy → new route) for old message URLs during the transition.

---

## 6. Open questions for Julio

1. **(a) server-streams vs (b) signed URLs?** *Recommend:* (a). It reuses
   `allowedArchives` with no new secrets; egress cost is acceptable for a
   self-hosted install.
2. **Should retracting the original also hide forwarded copies?** *Recommend:*
   no — each copy is its own message; retracting the forward hides it there.
   Serve while any visible non-deleted row references the URL.
3. **Delete bytes on retraction, or 404-only?** *Recommend:* 404 now (the
   security boundary); best-effort deletion with a grace period later, after
   the volume mount. Deletion never revokes already-leaked bytes.
4. **OK with a breaking change for old mobile builds that cannot send auth
   with media requests?** *Recommend:* yes, with a redirect transition window
   and a minimum-version announcement.
5. **Range-request support from day one?** *Recommend:* yes — audio/video
   scrubbing breaks without it, especially on mobile.
6. **Mount `ejabberd-uploads` into the server container (read-only first,
   read-write for the later deletion job)?** *Recommend:* yes; without it the
   server cannot stream (a) or delete anything. This is a live-server change
   only you can make.
