---
id: T-1315
title: "URGENT live bug: GET /api/files answers 502 file_unavailable for every chat file (phone and web photos don't load since SEC-3) — the internal fetch to ejabberd's /upload must carry the public Host; log the upstream status; same for voice transcription; tested"
status: merged
milestone: M5
branch: task/T-1315-files-proxy-host
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1315: The files proxy must send the public Host to ejabberd

## Spec (written by Claude, do not edit)

### Why
Lead's live check, 2026-10-13 02:45, read-only, from Julio's signed-in browser:
- **The file:** `GET /api/media?chat=<DM>&type=media` lists the photo `https://chat.zilar.app/upload/<id>/<token>/20.png`.
- **Fetched directly** (through Caddy → `ejabberd:5280`): **200 `image/png`**.
- **`GET /api/files?chat=<DM>&url=<that url>`: 502**, `{"error":{"code":"file_unavailable","message":"The file could not be loaded"}}`.
- **Impact:** since T-1185 (SEC-3, `c4add43`, 2026-10-12), mobile loads every chat file through `/api/files` (`apps/mobile/src/lib/media-source.ts`, `apps/mobile/src/lib/attachment-common.ts:83-97`), and web does too (`apps/web/src/lib/attachments.ts`, `ImageMessage.tsx`, `VoiceMessage.tsx`, `FileMessage.tsx`, `GifMessage.tsx`). So history photos, voice and files don't load. Julio saw it on the phone: the old bubble showed "Not loaded: untrusted address" after any load failure.

**The path:**
- the route (`apps/server/src/files/api.ts:215`) builds `internalUrl = toInternalUploadUrl(...)` (`apps/server/src/voice-transcription/routes.ts:142-165`), that is, `${new URL(config.xmpp.apiUrl).origin}/upload/...`;
- live, `EJABBERD_API_URL` is `http://ejabberd:5280/api` (`deploy/coolify/docker-compose.app.yml:154`), so the fetch (`api.ts:292-307`) goes to `http://ejabberd:5280/upload/...` with **Host `ejabberd:5280`**;
- any non-200/206/416 answer becomes the 502 (`api.ts:309-318`), and that branch logs nothing.

**The lead's hypothesis (verify it):** ejabberd's `mod_http_upload` serves a GET by finding the per-vhost upload process from the request's **Host** (in `mod_http_upload.erl`, `process/2` for `'GET'`/`'HEAD'` calls `get_proc_name(Host, ?MODULE)`). With Host `ejabberd` there's no such vhost, so it answers 404. The public request works because Caddy forwards Host `chat.zilar.app`. `ejabberd.yml:93-97` serves `/upload` on the same 5280 listener as `/api`, and `docroot` (`:235`) doesn't use `@HOST@`. If you can read the ejabberd source of the deployed image version (`deploy/ejabberd/Dockerfile` or the compose image tag; cite it), quote the lines; otherwise say it's unverified.

### What to build
1. **Send the public Host on the internal upload fetch:** `Host: <host of config.PUBLIC_URL>`, in both:
   - `apps/server/src/files/api.ts` (the `/api/files` proxy);
   - `apps/server/src/voice-transcription/api.ts:118` and onwards (same `toInternalUploadUrl`).
   Node's `fetch` (undici) may drop or refuse a `host` header. Check it with a test against a local `node:http` server that records the received Host. If `fetch` can't set it, use `node:http`'s `request` (or undici's `request`, if it's already a dependency) behind the existing `fetchImpl` seam, keeping the stream pass-through, the `range` header and the timeout. Put the shared helper in a new `apps/server/src/files/internal-fetch.ts`.
2. **Log the upstream status** in the non-200 branch (`api.ts:309-318`): `deps.logger.warn({ userId, status }, 'files upstream status')`, no URL or token.
3. **Tests** (message pipeline and permissions; files keep their auth checks), in `apps/server/src/files/routes.test.ts` or a new `internal-fetch.test.ts`, up to 3:
   - the internal request carries `Host: chat.zilar.app` when `PUBLIC_URL` is `https://chat.zilar.app`;
   - a 404 upstream still answers 502 and logs the status;
   - the `range` header still passes through.
4. Keep every file at most 400 lines (`files/api.ts` is 330).

### Read first
`AGENTS.md`, `apps/server/src/files/api.ts`, `apps/server/src/files/routes.test.ts`, `apps/server/src/voice-transcription/routes.ts:142-165`, `apps/server/src/voice-transcription/api.ts`, `deploy/ejabberd/ejabberd.yml:83-97,233-240`, and `deploy/coolify/docker-compose.app.yml:100-160`.

### Allowed files
`apps/server/src/files/*.ts`, `apps/server/src/voice-transcription/*.ts`, `work/T-1315-files-proxy-host.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/files src/voice-transcription --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- **The lead's live check after the deploy:** the same read-only `/api/files` call answers 200 `image/png`.

---

## Report (written by the worker when done)

### What I did

The internal upload fetch now carries the public host, in both callers, using a shared
`node:http` helper.

- **New `apps/server/src/files/internal-fetch.ts`** — `defaultInternalFetch(url, { host, range?, signal? })`
  sends `Host: <PUBLIC_URL host>` (and the caller's `Range`) with `node:http`/`node:https` `request`,
  returns `{ status, headers: Headers, body: ReadableStream<Uint8Array> }` so the files route still
  passes the body straight through. `fetch` could not be used: I tested it and Node's undici drops a
  `Host` header (the received host was the connection host, not the value set). The file carries a
  `// effect-plain:` marker because it is a transport primitive that `@effect/platform`'s fetch/undici
  client cannot express (same dropped-Host problem); this is how the gate's Effect ratchet treats new
  plain files (`exempt`).
- **`apps/server/src/files/api.ts`** — the `fetchImpl?: typeof fetch` seam became
  `internalFetch?: InternalFetch`, defaulting to `defaultInternalFetch`. It computes
  `uploadHost = new URL(deps.config.PUBLIC_URL).host` once and passes `host`, the `range` and the
  `AbortSignal.timeout(FILES_FETCH_TIMEOUT_MS)`. The non-200/206/416 branch now logs
  `deps.logger.warn({ userId, status }, 'files upstream status')` (status only, no URL/token) and
  releases the unread body before the fixed 502.
- **`apps/server/src/voice-transcription/pipeline.ts`** — `AudioFetcher` gained an
  `AudioFetchInit { host }` second argument; `FetchAndTranscribeInput` gained `uploadHost`;
  `defaultAudioFetcher` uses `defaultInternalFetch` (20 s timeout, non-2xx cancels the body).
- **`apps/server/src/voice-transcription/api.ts`** — computes `uploadHost` from `PUBLIC_URL` and
  passes it into `fetchAndTranscribe`.

### Ejabberd source check (the hypothesis)

The deployed image is `ghcr.io/processone/ejabberd:26.07`
(`deploy/ejabberd/Dockerfile:19`). In `src/mod_http_upload.erl` at tag `26.07`, the GET/HEAD clause of
`process/2` resolves the upload process from the request `host` header:

```erlang
process(_LocalPath, #request{method = Method, host = Host, ip = IP, headers = ReqHeaders} = Request0)
    when Method == 'GET'; Method == 'HEAD' ->
    Request = Request0#request{host = redecode_url(Host)},
    {Proc, [_UserDir, _RandDir, FileName] = Slot} = parse_http_request(Request),
    try gen_server:call(Proc, get_conf, ?CALL_TIMEOUT) of
```

`parse_http_request/1` does `Host = jid:nameprep(Host0)` and `gen_mod:get_module_proc(ProcURL, ?MODULE)`.
With host `ejabberd` there is no such process, so `gen_server:call` exits `{noproc, _}`, caught right
below into `http_response(404)`. The public GET works because Caddy forwards `chat.zilar.app`, the
vhost the process is registered under. **Hypothesis verified.**

### Files changed (all inside the Allowed files)

- `apps/server/src/files/internal-fetch.ts` (new)
- `apps/server/src/files/internal-fetch.test.ts` (new)
- `apps/server/src/files/api.ts`
- `apps/server/src/files/routes.test.ts`
- `apps/server/src/voice-transcription/pipeline.ts`
- `apps/server/src/voice-transcription/api.ts`
- `work/T-1315-files-proxy-host.md`

### Tests added (3)

1. `internal-fetch.test.ts`: against a local `node:http` server, `defaultInternalFetch` sends
   `Host: chat.zilar.app` and `Range: bytes=0-3` and streams the body through.
2. `routes.test.ts` — "sends the PUBLIC_URL host to the internal fetch": with `PUBLIC_URL`
   `https://chat.zilar.app`, the injected seam receives `host: 'chat.zilar.app'` and the internal
   URL on the ejabberd base.
3. `routes.test.ts` — "answers 502 and logs the status when the upstream 404s": 502
   `file_unavailable` and `logOutput()` contains `files upstream status` and `"status":404`.

Existing files tests were updated for the new seam shape (`host` on the recorded call).

### Commands (real results)

- `pnpm --filter @zilar/server exec vitest run src/files src/voice-transcription --reporter=dot --maxWorkers=2`
  → `Test Files 2 passed (2)`, `Tests 18 passed (18)`. (I added `--maxWorkers=2` per AGENTS.md; the
  task's Checks command omits the cap.)
- `pnpm gate` (from the repo root) → 7 changed files, all in scope:
  ```
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Deviations / notes

- The dependency was renamed `fetchImpl` → `internalFetch` (type `InternalFetch`) because `fetch`
  cannot set `Host`; `routes.test.ts` was updated in scope.
- `internal-fetch.ts` uses the `// effect-plain:` marker to pass the Effect ratchet; reason is in the
  marker line.
- Acceptance ("the lead's live check after the deploy") needs the deploy; I cannot run it.

### Security checklist

- Log line carries `userId` and `status` only — no URL, no upload token.
- The internal fetch still sends only `Host` and `Range`; caller cookies/auth stay behind.
- The auth/permission order is unchanged (401 → 501 → limiter → decode → 404s → fetch).
- No secrets, no new dependencies, no checks disabled.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (3 nits).**
- **Cause verified** in the ejabberd 26.07 source: `mod_http_upload` finds the upload process from the Host header.
- **Fix:**
  - Node's `fetch` drops a custom Host, so the new `internal-fetch.ts` uses `node:http`/`node:https` with Host = `PUBLIC_URL`'s host;
  - Range passes through, the body streams through unbuffered, and abort is handled;
  - a non-OK upstream releases its body and logs only the status.
  Voice transcription uses the same transport.
- **Lead's checks after the rebase:** server `src/files` + `src/voice-transcription`: 18 tests pass; server tsc: 0 errors. `files/api.ts` is 340 lines.
- **After the deploy:** the same read-only `/api/files` call must answer 200 `image/png`.
