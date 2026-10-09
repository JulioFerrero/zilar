import { parseUrl } from '@zilar/chat-core';
import { Duration, Effect } from 'effect';
import { runWeb } from '@/lib/effect/runtime';
import type { UploadSlotRequester } from './voice';

/** Hard cap on an attachment, mirroring the plan question D6 default. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Images the web treats as pictures. SVG is deliberately absent. */
const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

const FALLBACK_NAME = 'file';
const MAX_NAME_LENGTH = 255;

export class AttachmentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AttachmentError';
    this.code = code;
  }
}

/**
 * The browser-reported MIME decides whether a file is an image. An SVG (and
 * anything with an empty or unknown type) is a file: it can carry script, so it
 * is never rendered as an image.
 */
export function classify(file: File): 'image' | 'file' {
  return IMAGE_MIME_TYPES.has(file.type) ? 'image' : 'file';
}

/**
 * Strips directory parts, control characters and surrounding whitespace from a
 * file name and caps it at 255 characters. An empty result becomes `file`.
 */
export function cleanFilename(name: string): string {
  const withoutPath = name.split(/[/\\]/).pop() ?? '';
  const withoutControl = Array.from(withoutPath)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('');
  const trimmed = withoutControl.trim();
  if (trimmed.length === 0) {
    return FALLBACK_NAME;
  }
  return trimmed.slice(0, MAX_NAME_LENGTH);
}

/** Human size for preview bars and file cards, e.g. `2.4 MB`. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** The URL to follow only when it is http(s); anything else (`javascript:`, `data:`) is not. */
export function safeHttpUrl(url: string): string | undefined {
  const parsed = parseUrl(url);
  return parsed !== undefined && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    ? url
    : undefined;
}

/**
 * The URL the web should load a file from. A same-origin `/upload/` file is
 * routed through `GET /api/files` (T-0454), where the server checks the session
 * and the chat membership; every other URL — another origin (dev's ejabberd on
 * `:5280`), `blob:`, `data:` or garbage — is returned untouched so it keeps
 * loading directly.
 */
export function mediaSrc(
  chatId: string,
  url: string,
  origin: string = window.location.origin,
): string {
  const parsed = parseUrl(url);
  if (parsed === undefined) {
    return url;
  }
  if (parsed.origin !== origin) {
    return url;
  }
  if (!parsed.pathname.startsWith('/upload/') || parsed.pathname.length <= '/upload/'.length) {
    return url;
  }
  return `/api/files?chat=${encodeURIComponent(chatId)}&url=${encodeURIComponent(url)}`;
}

/**
 * Just enough of the XMPP token to build the trusted media set: the WebSocket
 * service URL and the XMPP domain the server issued for this session. Both are
 * where the upload service answers in dev and production.
 */
export interface MediaTokenShape {
  service: string;
  domain: string;
}

/**
 * The hostnames the renderer auto-loads images from. Anything else becomes a
 * file card that only loads on click, so a chat peer cannot make every viewer's
 * browser fetch a tracking pixel from a third-party host.
 */
export function trustedMediaHosts(token: MediaTokenShape): ReadonlySet<string> {
  const hosts = new Set<string>();
  // A malformed service URL just means we trust nothing from it; the domain
  // below still covers the production case.
  const serviceHost = parseUrl(token.service)?.hostname.toLowerCase();
  if (serviceHost !== undefined && serviceHost !== '') {
    hosts.add(serviceHost);
  }
  const domain = token.domain.trim().toLowerCase();
  if (domain !== '') {
    hosts.add(domain);
    hosts.add(`upload.${domain}`);
  }
  return hosts;
}

/**
 * Whether `url` is http(s) and its hostname matches one of `trustedHosts`
 * (case-insensitive, scheme- and port-agnostic). Anything that does not parse
 * as an http(s) URL — `javascript:`, `data:`, relative paths, garbage — is
 * untrusted.
 */
export function isTrustedMediaUrl(url: string, trustedHosts: ReadonlySet<string>): boolean {
  const parsed = parseUrl(url);
  if (parsed === undefined || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return false;
  }
  return trustedHosts.has(parsed.hostname.toLowerCase());
}

/** A best-effort object URL; test environments without it get `undefined`. */
export function objectUrlFor(blob: Blob): string | undefined {
  return Effect.runSync(
    Effect.try(() => URL.createObjectURL(blob)).pipe(Effect.orElseSucceed(() => undefined)),
  );
}

/**
 * The pixel size of an image, read through an `Image` and an object URL that is
 * always revoked. A decode error or a 5 s timeout resolves `undefined` so the
 * caller omits the dimensions and the bubble still renders.
 */
export function readImageSize(
  file: File,
  timeoutMs = 5000,
): Promise<{ width: number; height: number } | undefined> {
  return runWeb(readImageSizeEffect(file, timeoutMs));
}

export type ImageSize = { width: number; height: number };

// Loads the object URL into an `Image`. The load or error handler settles it;
// the timeout (which interrupts the wait and detaches the handlers) gives
// `undefined`, so an image that never answers cannot hang the caller.
const decodeImageSize = (
  objectUrl: string,
  timeoutMs: number,
): Effect.Effect<ImageSize | undefined> =>
  Effect.callback<ImageSize | undefined>((resume) => {
    const image = new Image();
    const detach = (): void => {
      image.onload = null;
      image.onerror = null;
    };
    const finish = (result: ImageSize | undefined): void => {
      detach();
      resume(Effect.succeed(result));
    };
    image.onload = () => {
      finish(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? { width: image.naturalWidth, height: image.naturalHeight }
          : undefined,
      );
    };
    image.onerror = () => finish(undefined);
    image.src = objectUrl;
    return Effect.sync(detach);
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(timeoutMs),
      orElse: () => Effect.succeed(undefined),
    }),
  );

export const readImageSizeEffect = (
  file: File,
  timeoutMs = 5000,
): Effect.Effect<ImageSize | undefined> =>
  Effect.suspend(() => {
    if (
      typeof Image === 'undefined' ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      return Effect.succeed(undefined);
    }
    // The object URL is always revoked once the image has settled; when it
    // cannot be created the size is simply omitted.
    return Effect.acquireUseRelease(
      Effect.try(() => URL.createObjectURL(file)),
      (objectUrl) => decodeImageSize(objectUrl, timeoutMs),
      (objectUrl) => Effect.sync(() => URL.revokeObjectURL(objectUrl)),
    ).pipe(Effect.orElseSucceed(() => undefined));
  });

/**
 * Asks for a XEP-0363 slot, PUTs the bytes with the slot's headers and returns
 * the download URL. The cap is enforced before any request is made; a refused
 * or unreachable PUT throws an `AttachmentError`.
 */
export function uploadAttachment(
  requester: UploadSlotRequester,
  file: File,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  return runWeb(uploadAttachmentEffect(requester, file, fetchFn));
}

// A rejection from `requestUploadSlot` is a defect, so the caller sees the
// original error; only the PUT failures become an `AttachmentError`.
export const uploadAttachmentEffect = Effect.fnUntraced(function* (
  requester: UploadSlotRequester,
  file: File,
  fetchFn: typeof fetch,
): Effect.fn.Return<string, AttachmentError> {
  if (file.size === 0) {
    return yield* Effect.fail(new AttachmentError('empty_file', 'That file is empty.'));
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return yield* Effect.fail(new AttachmentError('too_large', 'That file is larger than 50 MB.'));
  }

  const contentType = file.type === '' ? 'application/octet-stream' : file.type;
  const slot = yield* Effect.promise(() =>
    requester.requestUploadSlot({
      filename: cleanFilename(file.name),
      size: file.size,
      contentType,
    }),
  );

  const response = yield* Effect.tryPromise({
    try: () =>
      fetchFn(slot.putUrl, {
        method: 'PUT',
        headers: { 'content-type': contentType, ...slot.headers },
        body: file,
      }),
    catch: () => new AttachmentError('upload_failed', 'Could not upload the file'),
  });
  if (!response.ok) {
    return yield* Effect.fail(
      new AttachmentError('upload_failed', 'The upload service refused the file'),
    );
  }
  return slot.getUrl;
});

/**
 * The mime and file extension for GIF-tab bytes (T-0122), taken from the
 * proxied blob's real content type and validated against the four types the
 * media proxy serves. An unexpected type (e.g. mock-mode art) falls back to
 * the search result's kind so mock sends keep working.
 */
export function gifBlobType(
  blobType: string,
  kind: 'image' | 'video',
): { mime: string; extension: string } {
  switch (blobType) {
    case 'image/gif':
      return { mime: 'image/gif', extension: 'gif' };
    case 'image/webp':
      return { mime: 'image/webp', extension: 'webp' };
    case 'video/mp4':
      return { mime: 'video/mp4', extension: 'mp4' };
    case 'video/webm':
      return { mime: 'video/webm', extension: 'webm' };
    default:
      return kind === 'video'
        ? { mime: 'video/mp4', extension: 'mp4' }
        : { mime: 'image/gif', extension: 'gif' };
  }
}

/** A file chosen in the composer, before it is sent. */
export interface PendingAttachment {
  file: File;
  kind: 'image' | 'file';
}

/** The three attachment helpers the store needs; injected in tests. */
export interface AttachmentPort {
  classify: (file: File) => 'image' | 'file';
  readImageSize: (file: File) => Promise<{ width: number; height: number } | undefined>;
  upload: (requester: UploadSlotRequester, file: File) => Promise<string>;
}

export const defaultAttachmentPort: AttachmentPort = {
  classify: (file) => classify(file),
  readImageSize: (file) => readImageSize(file),
  upload: (requester, file) => uploadAttachment(requester, file),
};
