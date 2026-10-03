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
import { asc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { user, voiceTranscripts } from '../db/schema';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { classifyIp } from '../sandbox/ip-guard';
import { settingsCipherFor, type SetupTransaction } from '../setup/settings';
import {
  silentVerificationWav,
  transcribeAudio,
  TranscriptionProviderError,
  type TranscriptionFetch,
} from './provider';
import {
  deleteVoiceTranscriptionSettings,
  getVoiceTranscriptionSettings,
  saveVoiceTranscriptionSettings,
  VOICE_TRANSCRIPTION_DEFAULT_MODEL,
  type VoiceTranscriptionSettings,
} from './settings';

export const VOICE_TRANSCRIPT_RATE_LIMIT_MAX = 10;
export const VOICE_TRANSCRIPT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const VOICE_TRANSCRIPT_RATE_LIMIT_OWNER_MAX = 10;
export const VOICE_TRANSCRIPT_RATE_LIMIT_OWNER_WINDOW_MS = 10 * 60 * 1000;

const VOICE_TRANSCRIPT_MAX_BYTES = 10 * 1024 * 1024;
const VOICE_FETCH_TIMEOUT_MS = 20_000;

const transcriptBodySchema = z
  .object({
    url: z.string().min(1, { message: 'url must not be empty' }).max(2048, {
      message: 'url must be at most 2048 characters',
    }),
  })
  .strict();

const voiceSettingsBodySchema = z
  .object({
    baseUrl: z.string().trim().min(1, { message: 'baseUrl must not be empty' }).max(512, {
      message: 'baseUrl must be at most 512 characters',
    }),
    apiKey: z
      .string()
      .trim()
      .min(1, { message: 'apiKey must not be empty' })
      .max(512, { message: 'apiKey must be at most 512 characters' })
      .optional(),
    model: z
      .string()
      .trim()
      .min(1, { message: 'model must not be empty' })
      .max(128, { message: 'model must be at most 128 characters' })
      .optional(),
  })
  .strict();

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

export interface FetchedAudio {
  body: Uint8Array;
  contentType: string;
}

export type AudioFetcher = (url: string) => Promise<FetchedAudio>;

export type Transcriber = (input: {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  audio: Uint8Array;
  filename: string;
  mime: string;
}) => Promise<{ text: string; language: string | null }>;

/** The audio-fetch leg failed (ejabberd down, slow, or refusing): fixed
 * 502, never the network's error text and never a bare 500. */
export class AudioUnavailableError extends Error {
  constructor() {
    super('The voice file could not be fetched');
    this.name = 'AudioUnavailableError';
  }
}

function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'Not found');
}

// The server owner is the user with the earliest `createdAt`: there is no
// global admin role, so the first account to exist owns the integrations.
async function isOwner(db: ServerDatabase, userId: string): Promise<boolean> {
  const [first] = await db
    .select({ id: user.id })
    .from(user)
    .orderBy(asc(user.createdAt), asc(user.id))
    .limit(1);
  return first !== undefined && first.id === userId;
}

export function voiceTranscriptUrlHash(url: string): string {
  return createHash('sha256').update(url, 'utf8').digest('hex');
}

interface FetchAndTranscribeInput {
  db: ServerDatabase;
  urlHash: string;
  internalUrl: string;
  settings: VoiceTranscriptionSettings;
  fetchAudio: AudioFetcher;
  transcribe: Transcriber;
}

/**
 * Fetches the audio and transcribes it, then stores the result — with no
 * transaction held across the network. Only the re-check + insert runs in
 * one transaction under an advisory lock on the hash (a duplicate that won
 * the race reads the winner's row; `onConflictDoNothing` covers the last
 * overlap). Fetch-leg failures (ejabberd down, slow, refusing) surface as
 * `AudioUnavailableError`, which the route maps to a fixed 502; size and
 * content-type refusals keep their 413/422.
 */
async function fetchAndTranscribe(input: FetchAndTranscribeInput): Promise<string> {
  const { db, urlHash, internalUrl, settings, fetchAudio, transcribe } = input;
  let audio: FetchedAudio;
  try {
    audio = await fetchAudio(internalUrl);
  } catch {
    throw new AudioUnavailableError();
  }
  if (audio.body.byteLength > VOICE_TRANSCRIPT_MAX_BYTES) {
    throw new HttpError(413, 'voice_too_large', 'The recording is too large');
  }
  if (audio.body.byteLength === 0 || !isAudioContentType(audio.contentType)) {
    throw new HttpError(422, 'not_audio', 'The file is not a supported recording');
  }
  let result: { text: string; language: string | null };
  try {
    result = await transcribe({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      audio: audio.body,
      filename: 'voice.m4a',
      mime: audio.contentType,
    });
  } catch (error) {
    if (error instanceof TranscriptionProviderError) {
      throw new HttpError(
        502,
        'transcription_failed',
        'The transcription service failed, try again later',
      );
    }
    throw error;
  }
  await db.transaction(async (tx: SetupTransaction) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'voice-transcript:' + urlHash}))`);
    const [cached] = await tx
      .select({ text: voiceTranscripts.text })
      .from(voiceTranscripts)
      .where(eq(voiceTranscripts.urlHash, urlHash))
      .limit(1);
    if (cached !== undefined) {
      return;
    }
    await tx
      .insert(voiceTranscripts)
      .values({ urlHash, text: result.text, language: result.language })
      .onConflictDoNothing({ target: voiceTranscripts.urlHash });
  });
  const [stored] = await db
    .select({ text: voiceTranscripts.text })
    .from(voiceTranscripts)
    .where(eq(voiceTranscripts.urlHash, urlHash))
    .limit(1);
  return stored?.text ?? result.text;
}

export function createVoiceTranscriptionRoutes(deps: VoiceTranscriptionRoutesDependencies): Hono {
  const routes = new Hono();
  const now = deps.now ?? Date.now;
  const transcriptLimiter =
    deps.transcriptLimiter ??
    createRateLimiter({
      max: VOICE_TRANSCRIPT_RATE_LIMIT_MAX,
      windowMs: VOICE_TRANSCRIPT_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const settingsLimiter =
    deps.settingsLimiter ??
    createRateLimiter({
      max: VOICE_TRANSCRIPT_RATE_LIMIT_OWNER_MAX,
      windowMs: VOICE_TRANSCRIPT_RATE_LIMIT_OWNER_WINDOW_MS,
      now,
    });
  const fetchAudio = deps.audioFetcher ?? defaultAudioFetcher;
  const transcribe =
    deps.transcribe ?? (async (input) => transcribeAudio(input, defaultTranscriptionFetch));
  // In-flight transcripts by URL hash: two simultaneous taps on the same
  // voice message share one fetch + provider call instead of double-billing.
  // The entry is removed in `finally`, so a failure never poisons the next
  // tap; the DB row (re-checked under the lock at insert time) is the
  // durable cache, this map only dedupes the overlap window.
  const inFlight = new Map<string, Promise<string>>();

  async function requireOwner(userId: string): Promise<void> {
    if (!(await isOwner(deps.db, userId))) {
      throw notFound();
    }
  }

  async function storedSettings(): Promise<VoiceTranscriptionSettings | null> {
    try {
      return await getVoiceTranscriptionSettings(deps.db, settingsCipherFor(deps.config));
    } catch {
      // Fail closed (reads as "not configured"), but say so: a DB or
      // decrypt failure must not silently look like an unset endpoint. The
      // message is fixed — no error text, no key.
      deps.logger.warn({}, 'voice transcription settings could not be read');
      return null;
    }
  }

  routes.get('/voice/transcription', async (c) => {
    await requireSession(deps.auth, c.req.raw.headers);
    const settings = await storedSettings();
    return c.json({ enabled: settings !== null });
  });

  routes.post('/voice/transcript', async (c) => {
    const { user: caller } = await requireSession(deps.auth, c.req.raw.headers);
    const settings = await storedSettings();
    if (settings === null) {
      throw new HttpError(
        501,
        'transcription_not_configured',
        'Voice transcription is not set up on this server',
      );
    }
    // Validation before the rate limiter: malformed requests must not burn
    // the caller's budget. Cached hits still count (fine — they cost a row
    // read, and the budget is generous).
    const body = await c.req.json().catch(() => null);
    const parsed = transcriptBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    // The URL is validated against this install before any request is made:
    // same origin as `PUBLIC_URL`, path under `/upload/`.
    const internalUrl = toInternalUploadUrl(parsed.data.url, deps.config);
    if (internalUrl === null) {
      throw new HttpError(400, 'invalid_request', 'The voice URL is not from this server');
    }
    if (!transcriptLimiter.allow(caller.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    const urlHash = voiceTranscriptUrlHash(parsed.data.url);

    // Fast path: the durable cache, no lock. Misses share one in-flight
    // fetch + provider call per URL hash (finding 4: no transaction and no
    // advisory lock is held across the network — the lock only covers the
    // re-check + insert below, with `onConflictDoNothing` as the backstop).
    const [fastHit] = await deps.db
      .select({ text: voiceTranscripts.text })
      .from(voiceTranscripts)
      .where(eq(voiceTranscripts.urlHash, urlHash))
      .limit(1);
    if (fastHit !== undefined) {
      return c.json({ text: fastHit.text });
    }

    let shared = inFlight.get(urlHash);
    if (shared === undefined) {
      shared = fetchAndTranscribe({
        db: deps.db,
        urlHash,
        internalUrl,
        settings,
        fetchAudio,
        transcribe,
      });
      inFlight.set(urlHash, shared);
      // `.then` with both handlers (not `.finally`): the derived promise
      // resolves either way, so a failed share never surfaces as an
      // unhandled rejection — the awaiting requests already mapped it.
      const cleanup = (): void => {
        if (inFlight.get(urlHash) === shared) {
          inFlight.delete(urlHash);
        }
      };
      void shared.then(cleanup, cleanup);
    }
    let text: string;
    try {
      text = await shared;
    } catch (error) {
      if (error instanceof AudioUnavailableError) {
        throw new HttpError(
          502,
          'audio_unavailable',
          'The voice file could not be read, try again later',
        );
      }
      throw error;
    }

    void deps.audit?.record({
      actorUserId: caller.id,
      aiId: null,
      groupId: null,
      action: 'voice.transcript_requested',
      subjectId: null,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: { urlHash },
    });
    return c.json({ text });
  });

  routes.put('/settings/integrations/voice-transcription', async (c) => {
    const { user: caller } = await requireSession(deps.auth, c.req.raw.headers);
    await requireOwner(caller.id);
    if (!settingsLimiter.allow(caller.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again later');
    }
    const body = await c.req.json().catch(() => null);
    const parsed = voiceSettingsBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid_request',
        parsed.error.issues[0]?.message ?? 'Invalid request',
      );
    }
    const { normalized, problem } = normalizeBaseUrl(parsed.data.baseUrl);
    if (normalized === null) {
      throw new HttpError(400, 'invalid_request', problem ?? 'The base URL is not valid');
    }
    const candidate: VoiceTranscriptionSettings = {
      baseUrl: normalized,
      apiKey: parsed.data.apiKey ?? null,
      model: parsed.data.model ?? VOICE_TRANSCRIPTION_DEFAULT_MODEL,
    };

    // Verify before storing: the silent WAV goes through the real provider
    // path (same `transcribe` seam the transcript route uses). A clip the
    // endpoint accepts proves the URL/key/model work; a refusal answers 422
    // `endpoint_rejected`, a transport failure 422 `endpoint_unreachable` —
    // and nothing is stored either way.
    try {
      await transcribe({
        baseUrl: candidate.baseUrl,
        apiKey: candidate.apiKey,
        model: candidate.model,
        audio: silentVerificationWav(),
        filename: 'verify.wav',
        mime: 'audio/wav',
      });
    } catch (error) {
      if (error instanceof TranscriptionProviderError && error.kind === 'unreachable') {
        throw new HttpError(
          422,
          'endpoint_unreachable',
          'The transcription endpoint could not be reached. Check the URL.',
        );
      }
      if (error instanceof TranscriptionProviderError) {
        throw new HttpError(
          422,
          'endpoint_rejected',
          'The transcription endpoint rejected the test request. Check the URL, key and model.',
        );
      }
      throw new HttpError(
        422,
        'endpoint_unreachable',
        'The transcription endpoint could not be reached. Check the URL.',
      );
    }

    const cipher = settingsCipherFor(deps.config);
    await deps.db.transaction(async (tx: SetupTransaction) => {
      await saveVoiceTranscriptionSettings(tx, cipher, candidate);
    });

    void deps.audit?.record({
      actorUserId: caller.id,
      aiId: null,
      groupId: null,
      action: 'integrations.voice_transcription_set',
      subjectId: null,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: null,
    });
    return c.json({ ok: true });
  });

  routes.delete('/settings/integrations/voice-transcription', async (c) => {
    const { user: caller } = await requireSession(deps.auth, c.req.raw.headers);
    await requireOwner(caller.id);
    await deps.db.transaction(async (tx: SetupTransaction) => {
      await deleteVoiceTranscriptionSettings(tx);
    });
    void deps.audit?.record({
      actorUserId: caller.id,
      aiId: null,
      groupId: null,
      action: 'integrations.voice_transcription_removed',
      subjectId: null,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: null,
    });
    return c.json({ ok: true });
  });

  return routes;
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
function normalizeBaseUrl(raw: string): { normalized: string | null; problem?: string } {
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

function isAudioContentType(contentType: string): boolean {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return mime.startsWith('audio/') || mime === 'video/mp4' || mime === 'application/octet-stream';
}

const defaultTranscriptionFetch: TranscriptionFetch = (url, init) => fetch(url, init);

// The internal download leg: same path on ejabberd's API base, 10 MB cap,
// 20 s timeout. Every fetch-leg failure (transport, abort, non-OK, unreadable
// body) surfaces as `AudioUnavailableError` — the route maps it to a fixed
// 502, never a bare 500 and never the network's error text. The content type
// gates the provider call (`not_audio` without one); the bytes are never
// logged.
async function defaultAudioFetcher(url: string): Promise<FetchedAudio> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOICE_FETCH_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch {
      throw new AudioUnavailableError();
    }
    if (!response.ok) {
      throw new AudioUnavailableError();
    }
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const buffer = await response.arrayBuffer().catch(() => null);
    if (buffer === null) {
      throw new AudioUnavailableError();
    }
    return { body: new Uint8Array(buffer), contentType };
  } finally {
    clearTimeout(timer);
  }
}

export { VOICE_TRANSCRIPT_MAX_BYTES, VOICE_FETCH_TIMEOUT_MS };
