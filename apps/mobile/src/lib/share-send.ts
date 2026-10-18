import { Effect } from 'effect';
import { File, Paths } from 'expo-file-system';

import { EMPTY_MESSAGE, TOO_LARGE_MESSAGE } from './attachment-common';
import type { PickedFile } from './attachment-ports';
import { MAX_ATTACHMENT_BYTES } from './attachments';
import type { ShareDraft } from './share-intent';

/**
 * A fixed sentence, never platform text.
 */
export const SHARE_COPY_FAILED_MESSAGE = 'Could not read that file. Try again.';

/** A shared `file://` path outside the app cache is refused before anything is sent. */
export const SHARE_UNSUPPORTED_MESSAGE = 'That file cannot be shared.';

export interface ShareSendStore {
  sendText: (chatId: string, text: string) => void;
  sendAttachment: (chatId: string, file: PickedFile, options?: { caption?: string }) => void;
}

export type ShareFileCopy = (file: PickedFile) => Effect.Effect<PickedFile, unknown>;

export interface ShareSendDeps {
  copyFile?: ShareFileCopy;
}

export type ShareSendResult = { ok: true } | { ok: false; message: string };

const SENT: ShareSendResult = { ok: true };
const COPY_FAILED: ShareSendResult = { ok: false, message: SHARE_COPY_FAILED_MESSAGE };
const UNSUPPORTED: ShareSendResult = { ok: false, message: SHARE_UNSUPPORTED_MESSAGE };
const EMPTY_FILE: ShareSendResult = { ok: false, message: EMPTY_MESSAGE };
const TOO_LARGE_FILE: ShareSendResult = { ok: false, message: TOO_LARGE_MESSAGE };

/**
 * Another app could name a path in Zilar's private files, so `..` segments are refused too and cannot climb out of the cache root.
 */
function isCacheFileUri(uri: string): boolean {
  const root = Paths.cache.uri.endsWith('/') ? Paths.cache.uri : `${Paths.cache.uri}/`;
  if (!uri.startsWith(root)) {
    return false;
  }
  const relative = uri.slice(root.length);
  return relative.length > 0 && !relative.split('/').includes('..');
}

function isShareSourceUri(uri: string): boolean {
  return uri.startsWith('content://') || isCacheFileUri(uri);
}

export function shareCacheName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const safe = base.replace(/[^\w.-]+/g, '_').slice(0, 80);
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return `zilar-share-${unique}-${safe.length > 0 ? safe : 'file'}`;
}

/**
 * The uploader's PUT opens a path directly, so a `content://` uri must be copied first; the real size replaces the sender's, which is often `null`.
 */
const copyIntoCache: ShareFileCopy = Effect.fnUntraced(function* (file: PickedFile) {
  const destination = yield* Effect.try({
    try: () => new File(Paths.cache, shareCacheName(file.name)),
    catch: (error: unknown) => error,
  });
  const source = yield* Effect.try({
    try: () => new File(file.uri),
    catch: (error: unknown) => error,
  });
  yield* Effect.tryPromise({
    try: () => source.copy(destination),
    catch: (error: unknown) => error,
  });
  return { ...file, uri: destination.uri, size: destination.size };
});

/**
 * A `file://` uri is used only inside the app cache, so another app cannot point us at Zilar's own private files; the size rules are checked before any send, so a half-share never arrives. The copies stay in place for the uploader and a retry, since the OS clears the cache.
 */
export const sendShare = Effect.fnUntraced(function* (
  chatId: string,
  draft: ShareDraft,
  store: ShareSendStore,
  deps: ShareSendDeps = {},
) {
  const copyFile = deps.copyFile ?? copyIntoCache;
  const files: PickedFile[] = [];

  // Only `content://` and files inside the app cache are ours to read.
  for (const file of draft.files) {
    if (!isShareSourceUri(file.uri)) {
      return UNSUPPORTED;
    }
  }

  for (const file of draft.files) {
    if (!file.uri.startsWith('content://')) {
      files.push(file);
      continue;
    }
    const copied = yield* copyFile(file).pipe(
      Effect.map((result) => ({ ok: true as const, file: result })),
      Effect.catch(() => Effect.succeed({ ok: false as const })),
    );
    if (!copied.ok) {
      return COPY_FAILED;
    }
    files.push(copied.file);
  }

  // Refuse here so the screen shows the reason, not the store after "success".
  for (const file of files) {
    if (file.size === 0) {
      return EMPTY_FILE;
    }
    if (file.size !== undefined && file.size > MAX_ATTACHMENT_BYTES) {
      return TOO_LARGE_FILE;
    }
  }

  if (files.length === 0) {
    if (draft.text !== undefined) {
      store.sendText(chatId, draft.text);
    }
    return SENT;
  }

  files.forEach((file, index) => {
    store.sendAttachment(
      chatId,
      file,
      index === 0 && draft.text !== undefined ? { caption: draft.text } : undefined,
    );
  });
  return SENT;
});
