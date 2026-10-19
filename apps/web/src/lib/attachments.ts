import {
  classifyMime,
  cleanFilename,
  MAX_ATTACHMENT_BYTES,
  mimeOrOctetStream,
  parseUrl,
} from '@zilar/chat-core';
import { Duration, Effect } from 'effect';
import { runWeb } from '@/lib/effect/runtime';
import type { UploadSlotRequester } from '@zilar/client-core';

export {
  cleanFilename,
  formatFileSize,
  gifBlobType,
  isTrustedMediaUrl,
  MAX_ATTACHMENT_BYTES,
  safeHttpUrl,
  trustedMediaHosts,
  type MediaTokenShape,
} from '@zilar/chat-core';

export class AttachmentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AttachmentError';
    this.code = code;
  }
}

/** Whether the browser-reported MIME is an image; SVG and unknown types are files. */
export function classify(file: File): 'image' | 'file' {
  return classifyMime(file.type);
}

/** A same-origin /upload/ file is routed through GET /api/files, where the server checks the
 * session and the chat membership; any other URL is returned untouched so it loads directly. */
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

/** A best-effort object URL; test environments without it get undefined. */
export function objectUrlFor(blob: Blob): string | undefined {
  return Effect.runSync(
    Effect.try(() => URL.createObjectURL(blob)).pipe(Effect.orElseSucceed(() => undefined)),
  );
}

/** The pixel size of an image, read through an Image and an object URL that is always
 * revoked. A decode error or a 5 s timeout resolves undefined so the bubble still renders. */
export function readImageSize(
  file: File,
  timeoutMs = 5000,
): Promise<{ width: number; height: number } | undefined> {
  return runWeb(readImageSizeEffect(file, timeoutMs));
}

export type ImageSize = { width: number; height: number };

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
    // The object URL is always revoked once the image has settled.
    return Effect.acquireUseRelease(
      Effect.try(() => URL.createObjectURL(file)),
      (objectUrl) => decodeImageSize(objectUrl, timeoutMs),
      (objectUrl) => Effect.sync(() => URL.revokeObjectURL(objectUrl)),
    ).pipe(Effect.orElseSucceed(() => undefined));
  });

/** Asks for a XEP-0363 slot, PUTs the bytes with the slot's headers and returns the download
 * URL. The cap is enforced before any request; a refused PUT throws AttachmentError. */
export function uploadAttachment(
  requester: UploadSlotRequester,
  file: File,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  return runWeb(uploadAttachmentEffect(requester, file, fetchFn));
}

// Only PUT failures become an AttachmentError; a rejected slot request stays a defect.
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

  const contentType = mimeOrOctetStream(file.type);
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
