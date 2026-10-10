// The stickers upload body (part B, T-0602) and its capped body read, split
// out of `./api` by T-0992. The multipart/raw handler and its size cap and
// type checks are byte for byte the same as before; only the file moved.
//
// The limiter middleware already charged the budget (session -> limiter ->
// content-type branch -> upload). The multipart branch checks the declared
// length before parsing the form, so an over-cap body is rejected without
// buffering it; the raw branch streams through `readCapped`, which stops as
// soon as the cap is passed. The 201 body carries every `StickerView` field.

import { Effect, Stream } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpError } from '../errors';
import { STICKER_MAX_BYTES } from './image';
import { uploadSticker, type StickersServiceDeps } from './service';
import { decodePathId } from './api-decode';

// The upload route's request: the raw request plus the `:id` path param (the
// route declares no payload schema). `serviceDeps` is the same factory the
// other handlers use.
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
      const declared = Number(request.request.headers['content-length'] ?? '');
      if (Number.isFinite(declared) && declared > STICKER_MAX_BYTES + 64 * 1024) {
        throw new HttpError(413, 'sticker_too_large', 'The sticker is larger than 512 KiB');
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
      if (buffer.byteLength > STICKER_MAX_BYTES) {
        throw new HttpError(413, 'sticker_too_large', 'The sticker is larger than 512 KiB');
      }
      bytes = buffer;
      const rawEmoji = form.get('emoji');
      if (typeof rawEmoji === 'string' && rawEmoji !== '') {
        emoji = rawEmoji;
      }
      // Byte-identical to the old zod `z.string().max(8)` message.
      if (emoji !== undefined && emoji.length > 8) {
        throw new HttpError(
          400,
          'invalid_request',
          'Too big: expected string to have <=8 characters',
        );
      }
    } else {
      // Raw bytes: the client POSTs the file with an optional
      // `x-emoji` header.
      const declared = Number(request.request.headers['content-length'] ?? '');
      if (Number.isFinite(declared) && declared > STICKER_MAX_BYTES) {
        throw new HttpError(413, 'sticker_too_large', 'The sticker is larger than 512 KiB');
      }
      const capped = yield* readCapped(request.request.stream, STICKER_MAX_BYTES).pipe(
        Effect.orDie,
      );
      if (capped === undefined) {
        throw new HttpError(413, 'sticker_too_large', 'The sticker is larger than 512 KiB');
      }
      bytes = capped;
      const rawEmoji = request.request.headers['x-emoji'];
      if (rawEmoji !== undefined && rawEmoji !== '') {
        // Header values are latin1 ByteStrings, so the client
        // percent-encodes the emoji; decode at most the first 64
        // characters, then let the service validate the length.
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

// Reads the body stream chunk by chunk and stops as soon as the cap is passed,
// so a large upload never has to fit in memory. `undefined` means the cap was
// exceeded; the over-cap chunk itself is not collected.
function readCapped<E, R>(
  stream: Stream.Stream<Uint8Array, E, R>,
  cap: number,
): Effect.Effect<Uint8Array | undefined, E, R> {
  return Effect.gen(function* () {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let exceeded = false;
    yield* Stream.runForEachWhile(stream, (chunk) =>
      Effect.sync(() => {
        total += chunk.byteLength;
        if (total > cap) {
          exceeded = true;
          return false;
        }
        chunks.push(chunk);
        return true;
      }),
    );

    if (exceeded) {
      return undefined;
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  });
}
