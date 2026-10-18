import { Effect } from 'effect';
import type { OutgoingBytes, VoiceOut } from '@zilar/client-core/store';

import { API_URL } from '../../lib/auth';
import { getSessionToken } from '../../lib/session-token';
import type { PickedFile } from '../../lib/attachment-ports';
import { attachmentDataFor, classifyMobileFile } from '../../lib/attachments';
import {
  createVoicePort,
  VoiceError,
  type ConvertedVoice,
  type RecordedVoice,
  type VoicePort,
} from '../../lib/voice';
import type { RealStoreDeps } from './ports';

export function voicePortFor(deps: RealStoreDeps): VoicePort {
  if (deps.voice !== undefined) {
    return deps.voice;
  }
  const uploader = deps.uploader;
  if (uploader === undefined) {
    return {
      convert: () => Promise.reject(new VoiceError('network_error', 'Could not reach the server')),
      upload: () => Promise.reject(new VoiceError('network_error', 'Could not reach the server')),
    };
  }
  return createVoicePort({ apiUrl: API_URL, getToken: getSessionToken, uploader });
}

function pickedImageSize(file: PickedFile): { width: number; height: number } | undefined {
  const { width, height } = file;
  if (
    width === undefined ||
    height === undefined ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    return undefined;
  }
  return { width, height };
}

// The core `bytes` port over mobile's uploader and stat seams. An unknown size is stat'd once, right before the slot request (the slot API needs an exact count).
export function bytesFor(deps: RealStoreDeps): OutgoingBytes {
  const uploader = deps.uploader;
  const statSize = deps.statSize;
  return {
    describe: (file) => {
      const picked = file as PickedFile;
      const kind = classifyMobileFile(picked);
      const data = attachmentDataFor(picked, '');
      return {
        kind,
        name: data.name,
        size: data.size,
        mime: data.mime,
        ...(kind === 'image' ? { localUrl: picked.uri } : {}),
      };
    },
    measure: (file) => Effect.succeed(pickedImageSize(file as PickedFile)),
    upload: (core, file, onProgress, key) =>
      Effect.tryPromise(async () => {
        const picked = file as PickedFile;
        if (uploader === undefined) {
          throw new Error('no attachment uploader is available');
        }
        const contentType = picked.mimeType === '' ? 'application/octet-stream' : picked.mimeType;
        const size =
          picked.size !== undefined
            ? picked.size
            : statSize === undefined
              ? undefined
              : await statSize(picked.uri);
        if (size === undefined) {
          throw new Error('the file size could not be read');
        }
        const slot = await core.requestUploadSlot({
          filename: attachmentDataFor(picked, '').name,
          size,
          contentType,
        });
        await uploader.upload(
          picked,
          { putUrl: slot.putUrl, headers: slot.headers },
          onProgress,
          key,
        );
        return slot.getUrl;
      }),
  };
}

export function voiceOutFor(deps: RealStoreDeps): VoiceOut {
  const port = voicePortFor(deps);
  return {
    convert: (recording) =>
      Effect.tryPromise(() => port.convert(recording.bytes as RecordedVoice)).pipe(
        Effect.map((converted) => ({ durationMs: converted.durationMs, audio: converted })),
      ),
    upload: (core, audio, onProgress, key) =>
      Effect.tryPromise(() => port.upload(core, audio as ConvertedVoice, onProgress, key)),
  };
}
