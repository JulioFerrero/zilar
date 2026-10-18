import { Data, Effect } from 'effect';
import { useLayoutEffect, useRef } from 'react';
import type {
  createStickerPack,
  deletePackSticker,
  patchStickerPack,
  uploadStickerFile,
  Sticker,
} from '@/lib/api';
import { PrepError, type prepareStickerImage } from '@/lib/sticker-images';
import { useQuery } from '@/lib/effect/use-query';

export type PackEditorItemStatus = 'ready' | 'uploading' | 'done' | 'error';

export interface PackEditorItem {
  key: string;
  name: string;
  blob?: Blob | undefined;
  serverUrl?: string | undefined;
  mime: 'image/webp' | 'image/png';
  width: number;
  height: number;
  bytes: number;
  motion?: 'none' | 'animated' | 'video' | undefined;
  emoji: string;
  status: PackEditorItemStatus;
  error?: string | undefined;
  stickerId?: string | undefined;
}

export interface PackEditorProps {
  packId?: string | undefined;
  initialTitle?: string | undefined;
  initialVisibility?: 'private' | 'server' | undefined;
  initialStickers?: Sticker[] | undefined;
  onDone: (packId: string) => void;
  onCancel: () => void;
  prepare?: typeof prepareStickerImage;
  createPack?: typeof createStickerPack;
  uploadFile?: typeof uploadStickerFile;
  patchPack?: typeof patchStickerPack;
  deleteSticker?: typeof deletePackSticker;
}

export const PACK_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,video/webm,video/mp4,video/quicktime,.webm,.mp4,.mov';

export type PrepareSticker = typeof prepareStickerImage;

let editorKey = 0;
export function nextKey(): string {
  editorKey += 1;
  return `sticker-${editorKey}`;
}

/**
 * A single emoji (one grapheme cluster): ZWJ and flag sequences stay whole.
 */
export function takeSingleEmoji(value: string): string {
  if (value === '') {
    return '';
  }
  if (typeof Intl.Segmenter === 'function') {
    const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value);
    return segments.containing(0)?.segment ?? '';
  }
  return Array.from(value).slice(0, 1).join('');
}

function describePrepError(error: unknown, name: string): string {
  if (error instanceof PrepError) {
    return error.message;
  }
  return `${name}: the image could not be prepared.`;
}

export class CallFailed extends Data.TaggedError('PackCallFailed')<{ readonly error: unknown }> {}

export function call<A>(run: () => Promise<A>): Effect.Effect<A, CallFailed> {
  return Effect.tryPromise({ try: run, catch: (error) => new CallFailed({ error }) });
}

export function messageOf(failure: CallFailed, fallback: string): string {
  return failure.error instanceof Error ? failure.error.message : fallback;
}

function prepareItem(file: File, prepare: PrepareSticker): Effect.Effect<PackEditorItem> {
  const name = file.name !== '' ? file.name : 'image';
  return call(() => prepare(file)).pipe(
    Effect.match({
      onFailure: (failure): PackEditorItem => ({
        key: nextKey(),
        name,
        mime: 'image/webp',
        width: 0,
        height: 0,
        bytes: 0,
        emoji: '',
        status: 'error',
        error: describePrepError(failure.error, name),
      }),
      onSuccess: (prepared): PackEditorItem => ({
        key: nextKey(),
        name,
        blob: prepared.blob,
        mime: prepared.mime,
        width: prepared.width,
        height: prepared.height,
        bytes: prepared.bytes,
        motion: prepared.motion,
        emoji: '',
        status: 'ready',
      }),
    }),
  );
}

export interface PrepareBatchJob {
  readonly key: string;
  readonly files: File[];
}

export function PrepareBatch({
  files,
  prepare,
  onPrepared,
  onFinished,
}: {
  files: File[];
  prepare: PrepareSticker;
  onPrepared: (item: PackEditorItem) => void;
  onFinished: () => void;
}) {
  const latestPrepare = useRef(prepare);
  useLayoutEffect(() => {
    latestPrepare.current = prepare;
  });
  useQuery(
    () =>
      Effect.sync(() => latestPrepare.current).pipe(
        Effect.flatMap((currentPrepare) =>
          Effect.forEach(
            files,
            (file) =>
              prepareItem(file, currentPrepare).pipe(
                Effect.tap((item) => Effect.sync(() => onPrepared(item))),
              ),
            { discard: true },
          ),
        ),
        Effect.andThen(Effect.sync(() => onFinished())),
      ),
    [],
  );
  return null;
}
