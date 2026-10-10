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
  /** New items only: the prepared bytes (previewed through `BlobPreview`). */
  blob?: Blob | undefined;
  /** Existing stickers only: the server file URL shown directly. */
  serverUrl?: string | undefined;
  mime: 'image/webp' | 'image/png';
  width: number;
  height: number;
  bytes: number;
  emoji: string;
  status: PackEditorItemStatus;
  error?: string | undefined;
  /** The server id: set for existing stickers, and for new ones once uploaded. */
  stickerId?: string | undefined;
}

export interface PackEditorProps {
  /** Absent = create mode (the pack is created first, then stickers upload). */
  packId?: string | undefined;
  initialTitle?: string | undefined;
  initialVisibility?: 'private' | 'server' | undefined;
  /** The pack's current stickers in edit mode (shown first, removable, reorderable). */
  initialStickers?: Sticker[] | undefined;
  onDone: (packId: string) => void;
  onCancel: () => void;
  /** Injected in tests so no canvas is touched. */
  prepare?: typeof prepareStickerImage;
  createPack?: typeof createStickerPack;
  uploadFile?: typeof uploadStickerFile;
  patchPack?: typeof patchStickerPack;
  deleteSticker?: typeof deletePackSticker;
}

export const PACK_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/** The image preparation function, injectable in tests. */
export type PrepareSticker = typeof prepareStickerImage;

let editorKey = 0;
export function nextKey(): string {
  editorKey += 1;
  return `sticker-${editorKey}`;
}

/** A single emoji (one grapheme cluster): ZWJ and flag sequences stay whole. */
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

export function isEmojiLike(value: string): boolean {
  return value !== '' && /\p{Extended_Pictographic}/u.test(value);
}

function describePrepError(error: unknown, name: string): string {
  if (error instanceof PrepError) {
    return error.message;
  }
  return `${name}: the image could not be prepared.`;
}

/**
 * A call that failed. It keeps the thrown value whole, so a row or the form
 * shows the thrown Error's own message, as the editor always did.
 */
export class CallFailed extends Data.TaggedError('PackCallFailed')<{ readonly error: unknown }> {}

/** Lifts one Promise call (an api.ts function or an injected one) into an Effect. */
export function call<A>(run: () => Promise<A>): Effect.Effect<A, CallFailed> {
  return Effect.tryPromise({ try: run, catch: (error) => new CallFailed({ error }) });
}

/** The text of a failed call: the thrown Error's message, else the fixed sentence. */
export function messageOf(failure: CallFailed, fallback: string): string {
  return failure.error instanceof Error ? failure.error.message : fallback;
}

/** One picked file, prepared. A failure becomes an error row, never a lost file. */
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

/**
 * The files of one drop, prepared one after another as before. Each drop is
 * its own batch, so two drops still prepare side by side; the batch leaves
 * the list once its last file is in. The Effect starts on mount and stops
 * when the batch unmounts.
 */
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
  // The latest prepare prop, kept current on render (the pattern of use-action.ts).
  const latestPrepare = useRef(prepare);
  useLayoutEffect(() => {
    latestPrepare.current = prepare;
  });
  // The drop starts on mount and reads the prepare function then, so a drop
  // always uses the prop the editor had when the files were picked.
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
