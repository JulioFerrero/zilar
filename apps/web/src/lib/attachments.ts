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
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
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
  try {
    const serviceHost = new URL(token.service).hostname.toLowerCase();
    if (serviceHost !== '') {
      hosts.add(serviceHost);
    }
  } catch {
    // A malformed service URL just means we trust nothing from it; the domain
    // below still covers the production case.
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
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return trustedHosts.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** A best-effort object URL; test environments without it get `undefined`. */
export function objectUrlFor(blob: Blob): string | undefined {
  try {
    return URL.createObjectURL(blob);
  } catch {
    return undefined;
  }
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
  return new Promise((resolve) => {
    if (
      typeof Image === 'undefined' ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      resolve(undefined);
      return;
    }
    let objectUrl: string | undefined;
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      resolve(undefined);
      return;
    }
    const image = new Image();
    let settled = false;
    const finish = (result: { width: number; height: number } | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (objectUrl !== undefined) {
        URL.revokeObjectURL(objectUrl);
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    image.onload = () => {
      finish(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? { width: image.naturalWidth, height: image.naturalHeight }
          : undefined,
      );
    };
    image.onerror = () => finish(undefined);
    image.src = objectUrl;
  });
}

/**
 * Asks for a XEP-0363 slot, PUTs the bytes with the slot's headers and returns
 * the download URL. The cap is enforced before any request is made; a refused
 * or unreachable PUT throws an `AttachmentError`.
 */
export async function uploadAttachment(
  requester: UploadSlotRequester,
  file: File,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  if (file.size === 0) {
    throw new AttachmentError('empty_file', 'That file is empty.');
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError('too_large', 'That file is larger than 50 MB.');
  }

  const contentType = file.type === '' ? 'application/octet-stream' : file.type;
  const slot = await requester.requestUploadSlot({
    filename: cleanFilename(file.name),
    size: file.size,
    contentType,
  });

  let response: Response;
  try {
    response = await fetchFn(slot.putUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType, ...slot.headers },
      body: file,
    });
  } catch {
    throw new AttachmentError('upload_failed', 'Could not upload the file');
  }
  if (!response.ok) {
    throw new AttachmentError('upload_failed', 'The upload service refused the file');
  }
  return slot.getUrl;
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
