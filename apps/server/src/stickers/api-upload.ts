// The stickers upload body and its capped read. The limiter already charged
// the budget; multipart checks the declared length before parsing so an
// over-cap body is never buffered, and raw streams through `readCapped`,
// which stops at the cap.

import { Effect } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';
import { requestIdOf } from '../effect/http-core';
import { HttpError } from '../errors';
import { readCapped } from '../http/read-capped';
import { STICKER_MAX_UPLOAD_BYTES } from './image';
import { uploadSticker, type StickersServiceDeps } from './service';
import { decodePathId } from './api-decode';

// The upload request: the raw request plus the `:id` path param, since the
// route declares no payload schema.
export interface UploadStickerRequest {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly params: { readonly id: string };
}

export function runUploadSticker(
  request: UploadStickerRequest,
  user: { readonly id: string },
  serviceDeps: () => StickersServiceDeps,
) {
  return Effect.gen(function* () {
    const contentType = request.request.headers['content-type'] ?? '';
    let bytes: Uint8Array;
    let emoji: string | undefined;
    if (contentType.includes('multipart/form-data')) {
      // `formData()` buffers before size can be checked, so a declared length is
      // required; a chunked body with none would otherwise be read whole.
      const declaredHeader = request.request.headers['content-length'];
      const declared = declaredHeader === undefined ? Number.NaN : Number(declaredHeader);
      if (!Number.isFinite(declared) || declared < 0) {
        // `HttpError` only carries statuses the API answers with and 411 is not
        // one, so this fixed envelope is returned directly.
        return HttpServerResponse.jsonUnsafe(
          {
            error: {
              code: 'length_required',
              message: 'The upload must declare its length',
              requestId: requestIdOf(request.request),
            },
          },
          { status: 411 },
        );
      }
      if (declared > STICKER_MAX_UPLOAD_BYTES + 64 * 1024) {
        throw new HttpError(413, 'sticker_too_large', 'The file is larger than 4 MiB');
      }
      const webRequest = yield* HttpServerRequest.toWeb(request.request).pipe(Effect.orDie);
      const form = yield* Effect.promise(() => webRequest.formData().catch(() => null));
      if (!form) {
        throw new HttpError(400, 'invalid_request', 'The upload must carry one file');
      }
      const file = form.get('file');
      if (!(file instanceof File)) {
        throw new HttpError(400, 'invalid_request', 'The upload must carry one file');
      }
      const buffer = new Uint8Array(
        yield* Effect.promise(() => file.arrayBuffer().catch(() => new ArrayBuffer(0))),
      );
      if (buffer.byteLength > STICKER_MAX_UPLOAD_BYTES) {
        throw new HttpError(413, 'sticker_too_large', 'The file is larger than 4 MiB');
      }
      bytes = buffer;
      const rawEmoji = form.get('emoji');
      if (typeof rawEmoji === 'string' && rawEmoji !== '') {
        emoji = rawEmoji;
      }
      if (emoji !== undefined && emoji.length > 8) {
        throw new HttpError(
          400,
          'invalid_request',
          'Too big: expected string to have <=8 characters',
        );
      }
    } else {
      // Raw bytes: the client POSTs the file with an optional `x-emoji` header.
      const declared = Number(request.request.headers['content-length'] ?? '');
      if (Number.isFinite(declared) && declared > STICKER_MAX_UPLOAD_BYTES) {
        throw new HttpError(413, 'sticker_too_large', 'The file is larger than 4 MiB');
      }
      const capped = yield* readCapped(request.request.stream, STICKER_MAX_UPLOAD_BYTES).pipe(
        Effect.orDie,
      );
      if (capped === undefined) {
        throw new HttpError(413, 'sticker_too_large', 'The file is larger than 4 MiB');
      }
      bytes = capped;
      const rawEmoji = request.request.headers['x-emoji'];
      if (rawEmoji !== undefined && rawEmoji !== '') {
        // Header values are latin1, so the client percent-encodes the emoji; decode
        // at most 64 characters and let the service validate the length.
        let decodedEmoji = rawEmoji;
        if (decodedEmoji.includes('%')) {
          try {
            decodedEmoji = decodeURIComponent(decodedEmoji.slice(0, 64));
          } catch {
            throw new HttpError(400, 'invalid_request', 'The emoji header is not valid');
          }
        }
        emoji = decodedEmoji;
      }
    }
    const packId = yield* Effect.sync(() => decodePathId(request.params.id));
    return yield* Effect.promise(() =>
      uploadSticker(serviceDeps(), packId, user.id, bytes, emoji === undefined ? {} : { emoji }),
    );
  });
}
