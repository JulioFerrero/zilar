import { cleanFilename } from '@zilar/chat-core';
import { Exit, Schema } from 'effect';

import type { PickedFile } from './attachment-ports';

/**
 * Everything another app hands to the phone is untrusted, so the `/share` screen and the send path only ever see this draft.
 */
export interface ShareDraft {
  text?: string | undefined;
  files: PickedFile[];
}

/** A clean draft, or one fixed sentence to show; an input is never echoed. */
export type ShareDraftResult = { ok: true; draft: ShareDraft } | { ok: false; message: string };

const MAX_TEXT_LENGTH = 32_768;
const MAX_FILES = 10;
const FALLBACK_MIME = 'application/octet-stream';
const MIME_PATTERN = /^[\w.+-]+\/[\w.+-]+$/;

const REFUSALS = {
  tooLong: 'That text is too long to share.',
  tooManyFiles: 'You can share up to 10 files at once.',
  badFile: 'That file cannot be shared.',
  empty: 'There is nothing to share.',
  malformed: 'That share could not be read.',
} as const;

const ShareFileSchema = Schema.Struct({
  path: Schema.String,
  fileName: Schema.optional(Schema.NullOr(Schema.String)),
  mimeType: Schema.optional(Schema.NullOr(Schema.String)),
  size: Schema.optional(Schema.NullOr(Schema.Number)),
});

const SharePayloadSchema = Schema.Struct({
  text: Schema.optional(Schema.NullOr(Schema.String)),
  files: Schema.optional(Schema.NullOr(Schema.Array(ShareFileSchema))),
});

type ShareFile = typeof ShareFileSchema.Type;

function readText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Only paths the OS handed us: `file://` for a cache copy, `content://` on Android. */
function isShareablePath(path: string): boolean {
  return path.startsWith('file://') || path.startsWith('content://');
}

function readSize(size: number | null | undefined): number | undefined {
  return typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : undefined;
}

function toPickedFile(file: ShareFile): PickedFile | null {
  if (!isShareablePath(file.path)) {
    return null;
  }
  const mimeType =
    file.mimeType !== null && file.mimeType !== undefined && MIME_PATTERN.test(file.mimeType)
      ? file.mimeType
      : FALLBACK_MIME;
  return {
    uri: file.path,
    name: cleanFilename(file.fileName ?? ''),
    mimeType,
    size: readSize(file.size),
  };
}

/**
 * A malformed payload is refused before any field is trusted; every refusal is one fixed sentence.
 */
export function toShareDraft(intent: unknown): ShareDraftResult {
  const decoded = Schema.decodeUnknownExit(SharePayloadSchema)(intent);
  if (Exit.isFailure(decoded)) {
    return { ok: false, message: REFUSALS.malformed };
  }

  const text = readText(decoded.value.text);
  if (text !== undefined && text.length > MAX_TEXT_LENGTH) {
    return { ok: false, message: REFUSALS.tooLong };
  }

  const shared = decoded.value.files ?? [];
  if (shared.length > MAX_FILES) {
    return { ok: false, message: REFUSALS.tooManyFiles };
  }

  const files: PickedFile[] = [];
  for (const file of shared) {
    const picked = toPickedFile(file);
    if (picked === null) {
      return { ok: false, message: REFUSALS.badFile };
    }
    files.push(picked);
  }

  if (text === undefined && files.length === 0) {
    return { ok: false, message: REFUSALS.empty };
  }
  return { ok: true, draft: { text, files } };
}
