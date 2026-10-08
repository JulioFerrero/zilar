// Voice transcription routes (T-0170). Transcription is off by default
// and configured by the server owner: an OpenAI-compatible
// `POST {base}/audio/transcriptions` endpoint (OpenAI, Groq, or a
// self-hosted Whisper server), so cost and privacy stay the owner's
// choice. Transcripts are produced on demand when someone taps "Show
// transcript", then cached so each voice message is transcribed once.
//
// - `GET /api/voice/transcription` → `{ enabled }` for any signed-in user
//   (the web shows the control only when an endpoint is configured).
// - `POST /api/voice/transcript` body `{ url }` → `{ text }`. The `url`
//   must be an upload URL on this install (same origin as `PUBLIC_URL`,
//   path under `/upload/`); anything else is refused before any request is
//   made. The server fetches the audio from ejabberd internally
//   (`EJABBERD_API_URL` base, same path), enforcing a 10 MB cap and a 20 s
//   timeout, sends it to the configured endpoint, and caches the result in
//   `voice_transcripts` keyed by SHA-256 of the URL. A concurrent duplicate
//   request must not double-bill: simultaneous taps share one in-flight
//   fetch + provider call (an in-process map keyed by the hash), and the
//   insert re-checks the cache under an advisory lock on the hash (with
//   `onConflictDoNothing` as the backstop). No transaction or lock is held
//   across the network.
// - Errors: 501 `transcription_not_configured`, 413 `voice_too_large`,
//   422 `not_audio`, 429 `rate_limited` (10 per 10 minutes per user), 502
//   `transcription_failed` (provider refused) and 502 `audio_unavailable`
//   (the ejabberd fetch leg failed) — both fixed messages, never the
//   provider's or network's body.
// - Audit entries carry ids only (the URL hash, never the URL or the
//   text). The transcript text and the API key are never logged.
//
// Owner routes (same 404-for-everyone-else pattern as the other
// integration writes):
// - `PUT /api/settings/integrations/voice-transcription` body
//   `{ baseUrl, apiKey?, model? }`: validates the endpoint with a 1-second
//   generated silent WAV before storing; failure answers 422
//   `endpoint_unreachable`/`endpoint_rejected` with fixed messages and
//   stores nothing.
// - `DELETE /api/settings/integrations/voice-transcription` removes it.
// - `GET /api/settings/integrations` (owner) gains `voiceTranscription:
//   { configured, baseUrl, model }` — the key is never returned.

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { sqlRuntimeFor } from '../effect/sql';
import type { RateLimiter } from '../rate-limit';
import { classifyIp } from '../sandbox/ip-guard';
import { settingsCipherFor } from '../setup/settings';
import type { AudioFetcher, Transcriber } from './pipeline';
import { getVoiceTranscriptionSettings, type VoiceTranscriptionSettings } from './settings';

export const VOICE_TRANSCRIPT_RATE_LIMIT_MAX = 10;
export const VOICE_TRANSCRIPT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const VOICE_TRANSCRIPT_RATE_LIMIT_OWNER_MAX = 10;
export const VOICE_TRANSCRIPT_RATE_LIMIT_OWNER_WINDOW_MS = 10 * 60 * 1000;

export { VOICE_FETCH_TIMEOUT_MS, VOICE_TRANSCRIPT_MAX_BYTES } from './pipeline';

export interface VoiceTranscriptionRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  audit?: AuditRecorder;
  /** Overrides the per-user transcript limiter (tests inject a small budget). */
  transcriptLimiter?: RateLimiter | undefined;
  /** Overrides the per-user settings-write limiter (tests inject a budget). */
  settingsLimiter?: RateLimiter | undefined;
  /** Injected in tests; production trusts TRUSTED_PROXY_HOPS like join. */
  now?: (() => number) | undefined;
  /** Fetches the audio from ejabberd; tests inject a fake, never the network. */
  audioFetcher?: AudioFetcher | undefined;
  /** Posts audio to the transcription endpoint; tests inject a fake. */
  transcribe?: Transcriber | undefined;
}

export type { AudioFetcher, FetchedAudio, Transcriber } from './pipeline';

// `AudioUnavailableError` lives in `./pipeline` now (the Effect spike owns
// the fetch leg); re-exported here so existing importers keep working.
export { AudioUnavailableError } from './pipeline';

// Every owner lookup runs on the `effect/sql` client registered for this
// database (see `../effect/sql`); the exported functions stay `async` so the
// routes and tests keep their shape during the transition.
function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

// The server owner is the user with the earliest `createdAt`: there is no
// global admin role, so the first account to exist owns the integrations.
// `"user"` is a reserved word, so it stays quoted.
export async function isOwner(db: ServerDatabase, userId: string): Promise<boolean> {
  const [first] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`SELECT id FROM "user"
        ORDER BY created_at ASC, id ASC LIMIT 1`;
    }),
  );
  return first !== undefined && first.id === userId;
}

export function voiceTranscriptUrlHash(url: string): string {
  return createHash('sha256').update(url, 'utf8').digest('hex');
}

export interface VoiceTranscriptionPublicStatus {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
}

/** The non-secret slice of the stored settings for `GET /settings/integrations`. */
export async function voiceTranscriptionStatusFor(
  db: ServerDatabase,
  config: Pick<ServerConfig, 'ZILAR_KEY_ENCRYPTION_KEY' | 'BETTER_AUTH_SECRET'>,
  logger?: { warn: (fields: Record<string, unknown>, message: string) => void } | undefined,
): Promise<VoiceTranscriptionPublicStatus> {
  let settings: VoiceTranscriptionSettings | null = null;
  try {
    settings = await getVoiceTranscriptionSettings(db, settingsCipherFor(config));
  } catch {
    // Fail closed (reads as "not configured"), but say so: a DB or decrypt
    // failure must not silently look like an unset endpoint. The message is
    // fixed — no error text, no key.
    logger?.warn({}, 'voice transcription settings could not be read');
    settings = null;
  }
  if (settings === null) {
    return { configured: false, baseUrl: null, model: null };
  }
  return { configured: true, baseUrl: settings.baseUrl, model: settings.model };
}

/**
 * Maps a caller-supplied voice URL to the internal ejabberd fetch URL, or
 * null when the URL is not an upload URL on this install. The caller URL
 * must share the origin of `PUBLIC_URL` with a path under `/upload/`; the
 * fetch then goes to `EJABBERD_API_URL`'s base with the same path, so the
 * audio never leaves the server's own network for the download leg.
 */
export function toInternalUploadUrl(
  raw: string,
  config: Pick<ServerConfig, 'PUBLIC_URL'> & { xmpp: Pick<ServerConfig['xmpp'], 'apiUrl'> },
): string | null {
  let caller: URL;
  let expected: URL;
  try {
    caller = new URL(raw);
    expected = new URL(config.PUBLIC_URL);
  } catch {
    return null;
  }
  if (caller.origin !== expected.origin) {
    return null;
  }
  if (!caller.pathname.startsWith('/upload/') || caller.pathname === '/upload/') {
    return null;
  }
  if (caller.username !== '' || caller.password !== '') {
    return null;
  }
  const api = new URL(config.xmpp.apiUrl);
  return `${api.origin}${caller.pathname}${caller.search}`;
}

// https is required unless the host is `localhost` or a private address the
// owner typed on purpose (self-hosted Whisper on the LAN).
export function normalizeBaseUrl(raw: string): { normalized: string | null; problem?: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { normalized: null, problem: 'The base URL is not a valid URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { normalized: null, problem: 'The base URL must start with https:// or http://' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { normalized: null, problem: 'The base URL must not contain credentials' };
  }
  const host = parsed.hostname.toLowerCase();
  // `hostname` keeps the brackets on IPv6 literals (`[::1]`), so strip them
  // before comparing: `http://[::1]:8080/v1` is loopback like 127.0.0.1.
  const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const isLocalhost = bareHost === 'localhost' || bareHost.endsWith('.localhost');
  const isLoopbackIp = bareHost === '127.0.0.1' || bareHost === '::1';
  const version = isIP(bareHost);
  const isPrivateLiteral = version !== 0 && (isLoopbackIp || classifyIp(bareHost) === 'blocked');
  if (parsed.protocol === 'http:' && !isLocalhost && !isPrivateLiteral) {
    return {
      normalized: null,
      problem: 'The base URL must use https:// unless it is localhost or a private address',
    };
  }
  if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }
  if (parsed.pathname === '/') {
    parsed.pathname = '';
  }
  parsed.search = '';
  parsed.hash = '';
  return { normalized: parsed.toString().replace(/\/$/, '') };
}
