import type { AlbumRef } from '@zilar/chat-core';
import { type Attachment } from '@zilar/protocol';
import { Data, Effect, Fiber } from 'effect';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { AttachmentChoice } from '@/components/chat/attach-sheet';
import { createAttachmentPicker, createGifDownloader } from '@/lib/attachment-native';
import type { AttachmentPicker, GifDownloader, PickedFile } from '@/lib/attachment-ports';
import { classifyMobileFile } from '@/lib/attachments';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import type { GifItem } from '@/lib/gifs';
import { randomUuid } from '@/lib/polyfills';
import type { ReplyRef } from '@/lib/types';
import type { SendAttachmentOptions } from '@/store/types';

/**
 * A storage read or write, a server load, a picker or a download rejected.
 * The composer never shows the cause: each step either ignores the failure or
 * shows its own fixed sentence.
 */
export class ComposerStepFailed extends Data.TaggedError('ComposerStepFailed')<{
  readonly reason: unknown;
}> {}

/**
 * Lifts one Promise call into an Effect. `run` is called with no argument, so
 * the abort signal never lands in an optional parameter such as the `api` of
 * `loadStickerPacks`.
 */
export function step<A>(run: () => Promise<A>): Effect.Effect<A, ComposerStepFailed> {
  return Effect.tryPromise({
    try: () => run(),
    catch: (reason) => new ComposerStepFailed({ reason }),
  });
}

/**
 * A mock-mode demo attachment as a picked file. The `gradient:` URL is the
 * preview URI (the bubble renders the gradient placeholder, never a fetch);
 * the store replaces it with the mock served URL on send.
 */
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

/** The caption + reply options for an attachment send, shared by the two paths. */
export function captionOptions(text: string, replyTo: ReplyRef | undefined): SendAttachmentOptions {
  const caption = text.trim();
  return {
    ...(caption.length === 0 ? {} : { caption }),
    ...(replyTo === undefined ? {} : { replyTo }),
  };
}

/** The most files the composer stages and sends at once (T-1536). */
const MAX_STAGED_FILES = 10;
const MAX_FILES_MESSAGE = 'You can send up to 10 files at once.';

/** Telegram's album rule: only two or more pictures share one album. */
const ALBUM_MIN = 2;

/** One message of a multi-file send: the file and its album membership, if any. */
interface AttachmentSend {
  file: PickedFile;
  album?: AlbumRef;
}

/**
 * Plans a send (T-1536). Two or more staged pictures become one album, and an
 * album groups only *consecutive* messages (`groupMessages`), so all staged
 * images go first in pick order (their `index` counted among the images,
 * `count` the image count) and every other file follows in pick order. With
 * fewer than two images the pick order is kept and nothing is marked as an
 * album.
 */
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

/**
 * Appends a pick's files to the staged ones, keeping the first ten (T-1536).
 * `overflow` is true when a file was dropped, so the caller shows the cap
 * sentence in the attach error.
 */
function appendPicks(
  current: readonly PickedFile[],
  incoming: readonly PickedFile[],
): { files: PickedFile[]; overflow: boolean } {
  const next = [...current, ...incoming];
  return { files: next.slice(0, MAX_STAGED_FILES), overflow: next.length > MAX_STAGED_FILES };
}

/**
 * The composer's attachment and GIF send path (T-0150, T-0157): the native
 * picker seam, the picked file, the GIF download, and the shared caption
 * options. The `Composer` renders the sheets and the input row.
 */
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
  // Attachments (T-0150): the paperclip opens the attach sheet. Picking is
  // owned here (the native picker seam is injected for tests); sending goes
  // through the store's `sendAttachment` with the composer text as the
  // caption, exactly like web. Voice (T-0154): the mic button records through
  // the `VoiceRecorderButton` and sends through `onSendVoice`.
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | undefined>(undefined);
  const [picks, setPicks] = useState<PickedFile[]>([]);
  // Production defaults to the real `expo-file-system` stat for unknown
  // picker sizes (T-0157); tests inject a fake picker.
  const picker = useMemo(() => pickerProp ?? createAttachmentPicker(), [pickerProp]);
  const gifDownloader = useMemo(
    () => gifDownloaderProp ?? createGifDownloader(),
    [gifDownloaderProp],
  );
  // The press handler runs this action, which starts the picker (and so the
  // OS permission prompt) at once; the sheet is busy while it waits.
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
          // A pick adds to the staged files (T-1536) and closes the sheet, so
          // the strip and the send button are visible right away. Past the cap
          // the first ten stay and the attach error explains why.
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

  // A GIF pick fetches the media through the proxy, then sends it with the
  // existing attachment path (the composer text is the caption), exactly
  // like web's `sendGif`. The mime and the extension come from the real
  // content type; failures show the inline error, and the attachment
  // bubble's Retry covers upload failures.
  // Every pick runs as its own fiber, so two picks while the first download
  // is still running both send (a shared action would drop or replace one).
  // The handler that sends is inside `Effect.try`, so a throw there shows the
  // same sentence as a failed download. Unmounting interrupts the fibers
  // that are still running.
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

  // A pick stages several files (T-1536): when two or more are pictures they
  // send first, in pick order, as one album (`attachmentSends`); every other
  // file follows. With fewer than two pictures the pick order is kept and no
  // album marker is set. The composer text and the reply quote ride the first
  // message sent. The sheet closes and the composer clears. Returns whether it
  // handled the send, so the caller falls through to text.
  const sendPicked = (): boolean => {
    if (picks.length === 0) {
      return false;
    }
    if (onSendAttachment !== undefined) {
      attachmentSends(picks).forEach((send, index) => {
        const caption = index === 0 ? captionOptions(text, replyTo) : {};
        onSendAttachment(
          send.file,
          send.album === undefined ? caption : { ...caption, album: send.album },
        );
      });
    }
    setPicks([]);
    setAttachOpen(false);
    setAttachError(undefined);
    clearDraft();
    return true;
  };

  /** Removes one staged file from the strip and clears the attach error. */
  const removePick = (index: number) => {
    setPicks((current) => current.filter((_, position) => position !== index));
    setAttachError(undefined);
  };

  const openAttach = () => {
    setAttachError(undefined);
    // In mock mode the sheet lists the generated demo attachments, so the
    // flow works without a server; tapping one stages it, and Send uploads it
    // through the mock store like a picked file.
    setAttachOpen(true);
  };

  const closeAttach = () => {
    if (attachBusy) {
      return;
    }
    setAttachOpen(false);
    setAttachError(undefined);
  };

  // One pick attempt from the sheet: permission denials and oversized files
  // show a plain explanation and keep the sheet open; a cancel just closes
  // the busy state. A picked run stages every file in the composer's strip
  // and closes the sheet; the composer's send button sends them in order.
  const chooseAttachment = (choice: AttachmentChoice) => {
    setAttachError(undefined);
    pickAttachment(choice);
  };

  // A demo attachment becomes a staged file: the gradient URL is the preview
  // URI (never fetched), and the store sends the same wire shape. Like a real
  // pick it adds to what is staged (T-1536).
  const demoPick = (attachment: Attachment) => {
    setAttachError(undefined);
    const staged = appendPicks(picks, [demoPickedFile(attachment)]);
    setPicks(staged.files);
    if (staged.overflow) {
      setAttachError(MAX_FILES_MESSAGE);
    }
    setAttachOpen(false);
  };

  // The Gallery tab's send (T-1320): the selected assets arrive as picked files
  // and are added to the composer strip, exactly like a library pick (the same
  // append + close above), so albums (T-1271) and captions keep working.
  // `sendPicked` reads the same `picks`.
  const stageFiles = (files: PickedFile[]) => {
    const staged = appendPicks(picks, files);
    setPicks(staged.files);
    setAttachError(staged.overflow ? MAX_FILES_MESSAGE : undefined);
    setAttachOpen(false);
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
    stageFiles,
  };
}
