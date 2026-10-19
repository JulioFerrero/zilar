// Transcription is off by default and configured by the server owner with an
// OpenAI-compatible endpoint, so cost and privacy stay their choice. The audio URL must
// be an upload on this install; the fetch goes through ejabberd internally under a 10 MB
// cap and 20 s timeout, and the result is cached by URL hash. Errors are fixed codes,
// never the provider's or network's body; audit entries carry ids and the hash only.

import type { ServerCore } from '../app/deps';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { Effect } from 'effect';

import type { AuditRecorder } from '../audit/recorder';
import type { ServerConfig } from '../config/load';
import { classifyIp } from '@zilar/desk/egress/ip-guard';

import type { ServerDatabase } from '../db/client';
import type { RateLimiter } from '../rate-limit';
import { settingsCipherFor } from '../setup/settings';
import type { AudioFetcher, Transcriber } from './pipeline';
import { getVoiceTranscriptionSettings, type VoiceTranscriptionSettings } from './settings';

export { VOICE_FETCH_TIMEOUT_MS, VOICE_TRANSCRIPT_MAX_BYTES } from './pipeline';

export interface VoiceTranscriptionRoutesDependencies extends Pick<
  ServerCore,
  'auth' | 'db' | 'config' | 'logger'
> {
  audit?: AuditRecorder;
  transcriptLimiter?: RateLimiter | undefined;
  settingsLimiter?: RateLimiter | undefined;
  now?: (() => number) | undefined;
  audioFetcher?: AudioFetcher | undefined;
  transcribe?: Transcriber | undefined;
}

export type { AudioFetcher, FetchedAudio, Transcriber } from './pipeline';

export { AudioUnavailableError } from './pipeline';

export function voiceTranscriptUrlHash(url: string): string {
  // The query string and fragment are not part of the audio's identity, so `?1` and `?2`
  // share one cache entry instead of billing twice.
  const canonical = new URL(url);
  canonical.search = '';
  canonical.hash = '';
  return createHash('sha256').update(canonical.toString(), 'utf8').digest('hex');
}

export interface VoiceTranscriptionPublicStatus {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
}

export async function voiceTranscriptionStatusFor(
  db: ServerDatabase,
  config: Pick<ServerConfig, 'ZILAR_KEY_ENCRYPTION_KEY' | 'BETTER_AUTH_SECRET'>,
  logger?: { warn: (fields: Record<string, unknown>, message: string) => void } | undefined,
): Promise<VoiceTranscriptionPublicStatus> {
  const settings = await Effect.runPromise(
    Effect.tryPromise(() => getVoiceTranscriptionSettings(db, settingsCipherFor(config))).pipe(
      Effect.orElseSucceed((): VoiceTranscriptionSettings | null => {
        // Fail closed (reads as "not configured"), but say so with a fixed message: no
        // error text, no key.
        logger?.warn({}, 'voice transcription settings could not be read');
        return null;
      }),
    ),
  );
  if (settings === null) {
    return { configured: false, baseUrl: null, model: null };
  }
  return { configured: true, baseUrl: settings.baseUrl, model: settings.model };
}

/**
 * Maps a caller-supplied voice URL to the internal ejabberd fetch URL, or null when it is
 * not an upload on this install. The caller URL must share `PUBLIC_URL`'s origin with a
 * path under `/upload/`, so the audio never leaves the server's own network for the
 * download leg.
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
  return `${api.origin}${caller.pathname}`;
}

// https is required unless the host is `localhost` or a private address the owner typed on
// purpose (self-hosted Whisper on the LAN).
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
  // `hostname` keeps the brackets on IPv6 literals (`[::1]`), so strip them before
  // comparing.
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
