import type { AlbumRef } from '@zilar/chat-core';
import type { Attachment } from '@zilar/protocol';
import { Data, Effect, Fiber, type Effect as EffectType } from 'effect';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';

import type { AttachmentChoice } from '@/components/chat/attach-sheet';
import { createAttachmentPicker } from '@/lib/attachment-picker';
import type { AttachmentPicker, GifDownloader, PickedFile } from '@/lib/attachment-ports';
import { classifyMobileFile, cleanFilename, MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import {
  type GifItem,
  gifBlobType,
  gifFileName,
  isGifMediaType,
  isLoadableGifPreviewUrl,
} from '@/lib/gifs';
import { randomUuid } from '@/lib/polyfills';
import type { ReplyRef } from '@/lib/types';
import type { SendAttachmentOptions } from '@/store/types';
import { API_URL } from '../../lib/auth';
import { getSessionToken } from '../../lib/session-token';
import { authHeadersFor, NativeFailure, orErrorResult } from '../../lib/attachment-common';

const GIF_DOWNLOAD_FAILED_MESSAGE = 'Could not load that GIF. Try another.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function headerMimeType(headers: Record<string, string>): string {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'content-type') {
      return value.split(';')[0]?.trim().toLowerCase() ?? '';
    }
  }
  return '';
}

type GifInput = Parameters<GifDownloader['download']>[0];
type GifResult = Awaited<ReturnType<GifDownloader['download']>>;

const downloadGifEffect = Effect.fnUntraced(function* (
  gif: GifInput,
  apiUrl: string,
  getToken: (() => Promise<string | undefined>) | undefined,
  download: typeof FileSystem.downloadAsync,
  getInfo: typeof FileSystem.getInfoAsync,
  cacheDir: string | null | undefined,
): EffectType.fn.Return<GifResult, NativeFailure> {
  if (!isLoadableGifPreviewUrl(gif.url, apiUrl)) {
    return { status: 'error', message: GIF_DOWNLOAD_FAILED_MESSAGE };
  }
  const headers = yield* authHeadersFor(gif.url, apiUrl, getToken);
  if (cacheDir === null || cacheDir === undefined) {
    return { status: 'error', message: GIF_DOWNLOAD_FAILED_MESSAGE };
  }
  const provisional = cleanFilename(`${gifFileName(gif.id, 'bin')}-${Date.now()}`);
  const result = yield* Effect.tryPromise({
    try: () =>
      download(
        gif.url,
        `${cacheDir}${provisional}`,
        headers === undefined ? undefined : { headers },
      ),
    catch: () => new NativeFailure({ message: GIF_DOWNLOAD_FAILED_MESSAGE }),
  });
  const contentType = isRecord(result) ? headerMimeType(result.headers ?? {}) : '';
  if (!isGifMediaType(contentType)) {
    return { status: 'error', message: GIF_DOWNLOAD_FAILED_MESSAGE };
  }
  const { mime, extension } = gifBlobType(contentType, gif.kind);
  const size = typeof result.uri === 'string' ? yield* fileSize(result.uri, getInfo) : 0;
  if (size === 0) {
    return { status: 'error', message: GIF_DOWNLOAD_FAILED_MESSAGE };
  }
  if (size > MAX_ATTACHMENT_BYTES) {
    return { status: 'error', message: 'That GIF is larger than 50 MB.' };
  }
  const file: PickedFile = {
    uri: result.uri,
    name: gifFileName(gif.id, extension),
    mimeType: mime,
    size,
  };
  if (gif.kind === 'image') {
    file.width = gif.width;
    file.height = gif.height;
  }
  return { status: 'downloaded', file };
});

/**
 * The URL is re-checked against the proxy gate before any fetch, the session bearer rides only to the API origin, and the mime comes from the real content type, never from the search result.
 */
function createGifDownloader(options?: {
  apiUrl?: string | undefined;
  getToken?: (() => Promise<string | undefined>) | undefined;
  download?: typeof FileSystem.downloadAsync | undefined;
  getInfo?: typeof FileSystem.getInfoAsync | undefined;
  cacheDir?: string | null | undefined;
}): GifDownloader {
  const apiUrl = options?.apiUrl ?? API_URL;
  const getToken = options?.getToken ?? getSessionToken;
  const download = options?.download ?? FileSystem.downloadAsync;
  const getInfo = options?.getInfo ?? FileSystem.getInfoAsync;
  return {
    download(gif: GifInput): Promise<GifResult> {
      const cacheDir = options?.cacheDir ?? FileSystem.cacheDirectory;
      return Effect.runPromise(
        orErrorResult(downloadGifEffect(gif, apiUrl, getToken, download, getInfo, cacheDir)),
      );
    },
  };
}

const fileSize = (uri: string, getInfo: typeof FileSystem.getInfoAsync): Effect.Effect<number> =>
  Effect.tryPromise({ try: () => getInfo(uri), catch: () => undefined }).pipe(
    Effect.map((info) => (info.exists === true && info.isDirectory === false ? info.size : 0)),
    Effect.orElseSucceed((): number => 0),
    Effect.catchDefect(() => Effect.succeed(0)),
  );

export class ComposerStepFailed extends Data.TaggedError('ComposerStepFailed')<{
  readonly reason: unknown;
}> {}

/** Calls `run` with no argument so the abort signal never lands in an optional parameter. */
export function step<A>(run: () => Promise<A>): Effect.Effect<A, ComposerStepFailed> {
  return Effect.tryPromise({
    try: () => run(),
    catch: (reason) => new ComposerStepFailed({ reason }),
  });
}

function demoPickedFile(attachment: Attachment): PickedFile {
  return {
    uri: attachment.url,
    name: attachment.name,
    mimeType: attachment.mime,
    size: attachment.size,
    ...(attachment.width === undefined ? {} : { width: attachment.width }),
    ...(attachment.height === undefined ? {} : { height: attachment.height }),
  };
}

export function captionOptions(text: string, replyTo: ReplyRef | undefined): SendAttachmentOptions {
  const caption = text.trim();
  return {
    ...(caption.length === 0 ? {} : { caption }),
    ...(replyTo === undefined ? {} : { replyTo }),
  };
}

/** The most files the composer stages and sends at once. */
const MAX_STAGED_FILES = 10;
const MAX_FILES_MESSAGE = 'You can send up to 10 files at once.';

/** Telegram's album rule: only two or more pictures share one album. */
const ALBUM_MIN = 2;

interface AttachmentSend {
  file: PickedFile;
  album?: AlbumRef;
}

/** An album groups only consecutive messages, so staged images go first in
 *  pick order and every other file follows. */
function attachmentSends(picks: readonly PickedFile[]): AttachmentSend[] {
  const images = picks.filter((file) => classifyMobileFile(file) === 'image');
  if (images.length < ALBUM_MIN) {
    return picks.map((file) => ({ file }));
  }
  const id = randomUuid();
  const sends: AttachmentSend[] = images.map((file, index) => ({
    file,
    album: { id, index, count: images.length },
  }));
  for (const file of picks) {
    if (classifyMobileFile(file) !== 'image') {
      sends.push({ file });
    }
  }
  return sends;
}

/** Keeps the first ten staged files; `overflow` means the caller shows the cap sentence. */
function appendPicks(
  current: readonly PickedFile[],
  incoming: readonly PickedFile[],
): { files: PickedFile[]; overflow: boolean } {
  const next = [...current, ...incoming];
  return { files: next.slice(0, MAX_STAGED_FILES), overflow: next.length > MAX_STAGED_FILES };
}

export function useComposerMedia({
  text,
  replyTo,
  onSendAttachment,
  picker: pickerProp,
  gifDownloader: gifDownloaderProp,
  clearDraft,
  onCloseSheet,
}: {
  text: string;
  replyTo: ReplyRef | undefined;
  onSendAttachment: ((file: PickedFile, options?: SendAttachmentOptions) => void) | undefined;
  picker?: AttachmentPicker | undefined;
  gifDownloader?: GifDownloader | undefined;
  clearDraft: () => void;
  onCloseSheet: () => void;
}) {
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | undefined>(undefined);
  const [picks, setPicks] = useState<PickedFile[]>([]);
  // Production defaults to the real `expo-file-system` stat for unknown sizes.
  const picker = useMemo(() => pickerProp ?? createAttachmentPicker(), [pickerProp]);
  const gifDownloader = useMemo(
    () => gifDownloaderProp ?? createGifDownloader(),
    [gifDownloaderProp],
  );
  const [pickState, pickAttachment] = useAction((choice: AttachmentChoice) =>
    step(() =>
      choice === 'library'
        ? picker.pickImageOrVideo()
        : choice === 'camera'
          ? picker.takePhoto()
          : picker.pickFile(),
    ).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          if (result.status === 'cancelled') {
            return;
          }
          if (result.status === 'error') {
            setAttachError(result.message);
            return;
          }
          const staged = appendPicks(picks, result.files);
          setPicks(staged.files);
          if (staged.overflow) {
            setAttachError(MAX_FILES_MESSAGE);
          }
          setAttachOpen(false);
        }),
      ),
      Effect.catchTag('ComposerStepFailed', () =>
        Effect.sync(() => setAttachError('Could not pick that file. Try again.')),
      ),
    ),
  );
  const attachBusy = isWaiting(pickState);
  const canSend = text.trim().length > 0 || picks.length > 0;

  // Every pick runs as its own fiber, so two picks while the first download runs
  // both send instead of dropping one.
  const gifFibers = useRef(new Set<Fiber.Fiber<void, never>>());
  useEffect(() => {
    const running = gifFibers.current;
    return () => {
      Effect.runFork(Fiber.interruptAll(running));
      running.clear();
    };
  }, []);

  const sendGif = (gif: GifItem) => {
    const send = onSendAttachment;
    const fiber = Effect.runFork(
      step(() => gifDownloader.download(gif)).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () => {
              if (result.status !== 'downloaded') {
                setAttachError(result.message);
                return;
              }
              send?.(result.file, captionOptions(text, replyTo));
              clearDraft();
            },
            catch: (reason) => new ComposerStepFailed({ reason }),
          }),
        ),
        Effect.catchTag('ComposerStepFailed', () =>
          Effect.sync(() => setAttachError('Could not load that GIF. Try another.')),
        ),
      ),
    );
    gifFibers.current.add(fiber);
    fiber.addObserver(() => gifFibers.current.delete(fiber));
  };

  const pickGif = (gif: GifItem) => {
    onCloseSheet();
    if (onSendAttachment === undefined) {
      return;
    }
    sendGif(gif);
  };

  const sendNow = (files: readonly PickedFile[], error?: string) => {
    if (onSendAttachment !== undefined) {
      attachmentSends(files).forEach((send, index) => {
        const caption = index === 0 ? captionOptions(text, replyTo) : {};
        onSendAttachment(
          send.file,
          send.album === undefined ? caption : { ...caption, album: send.album },
        );
      });
    }
    setPicks([]);
    setAttachOpen(false);
    setAttachError(error);
    clearDraft();
  };

  const sendPicked = (): boolean => {
    if (picks.length === 0) {
      return false;
    }
    sendNow(picks);
    return true;
  };

  const removePick = (index: number) => {
    setPicks((current) => current.filter((_, position) => position !== index));
    setAttachError(undefined);
  };

  const openAttach = () => {
    setAttachError(undefined);
    setAttachOpen(true);
  };

  const closeAttach = () => {
    if (attachBusy) {
      return;
    }
    setAttachOpen(false);
    setAttachError(undefined);
  };

  const chooseAttachment = (choice: AttachmentChoice) => {
    setAttachError(undefined);
    pickAttachment(choice);
  };

  const demoPick = (attachment: Attachment) => {
    setAttachError(undefined);
    const staged = appendPicks(picks, [demoPickedFile(attachment)]);
    setPicks(staged.files);
    if (staged.overflow) {
      setAttachError(MAX_FILES_MESSAGE);
    }
    setAttachOpen(false);
  };

  const sendFiles = (files: PickedFile[]) => {
    const all = appendPicks(picks, files);
    sendNow(all.files, all.overflow ? MAX_FILES_MESSAGE : undefined);
  };

  return {
    attachOpen,
    attachError,
    setAttachError,
    picks,
    removePick,
    voiceRecording,
    setVoiceRecording,
    attachBusy,
    canSend,
    sendGif,
    pickGif,
    sendPicked,
    openAttach,
    closeAttach,
    chooseAttachment,
    demoPick,
    sendFiles,
  };
}
