// The browser-backed port adapters of the web chat store: `localStorage`, the
// document visibility and focus events, the rows, flags and notifications
// adapters, the sign-out redirect, and the core `bytes` and `voice` ports over
// web's attachment and voice ports. `ports.ts` composes them in `resolvePorts`;
// this module imports types from `./ports` only, so there is no runtime cycle.
import { Effect } from 'effect';
import type {
  ChatRows,
  Notifications,
  OutgoingBytes,
  StoreFlags,
  VoiceOut,
} from '@zilar/client-core/store';
import type { ChatEntry } from '@/lib/api';
import { cleanFilename, type AttachmentPort } from '@/lib/attachments';
import { dismissChatNotifications, totalBadgeUnread, updateAppBadge } from '@/lib/push';
import type { VoicePort } from '@/lib/voice';
import { summariesFor } from './chatRows';
import { fromPromise } from './util';
import type { StorageLike } from './ports';

// The browser storage, or null where it is blocked or missing.
export function defaultStorage(): StorageLike | null {
  return Effect.runSync(
    Effect.try(() => window.localStorage).pipe(Effect.orElseSucceed(() => null)),
  );
}

export function defaultVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

export function defaultOnFocus(handler: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener('focus', handler);
  return () => window.removeEventListener('focus', handler);
}

export const realRows: ChatRows = {
  summariesFor: (entry) => summariesFor(entry as ChatEntry),
};

export const webFlags: StoreFlags = { connectRetry: true, reconnectOnResume: false };

// The app badge and the push dismiss, best effort (mirrors `effects/badge.ts`).
export const liveNotifications: Notifications = {
  syncBadge: (chats) => {
    Effect.runFork(
      fromPromise(() => updateAppBadge(totalBadgeUnread([...chats]))).pipe(Effect.ignore),
    );
  },
  dismissChat: (chatId) => {
    Effect.runFork(fromPromise(() => dismissChatNotifications(chatId)).pipe(Effect.ignore));
  },
};

// A reload gives the next user a fresh store and XMPP connection.
export function defaultGoToLogin(): void {
  if (typeof window !== 'undefined') {
    window.location.assign('/login');
  }
}

// `URL.createObjectURL` is missing in some test environments.
function objectUrlFor(blob: Blob): string | undefined {
  return Effect.runSync(
    Effect.try(() => URL.createObjectURL(blob)).pipe(Effect.orElseSucceed(() => undefined)),
  );
}

// The core `bytes` port over web's attachment port (T10): classification, the
// image size and the XEP-0363 upload. Web has no cancel and ignores progress.
export function bytesFromAttachmentPort(port: AttachmentPort): OutgoingBytes {
  return {
    describe: (file) => {
      const picked = file as File;
      const kind = port.classify(picked);
      return {
        kind,
        name: cleanFilename(picked.name),
        size: picked.size,
        mime: picked.type === '' ? 'application/octet-stream' : picked.type,
        ...(kind === 'image' ? { localUrl: objectUrlFor(picked) } : {}),
      };
    },
    measure: (file) => fromPromise(() => port.readImageSize(file as File)),
    upload: (core, file) => fromPromise(() => port.upload(core, file as File)),
  };
}

// The core `voice` port over web's voice port (T10). The recording's bytes are
// opaque to the core, so this unwraps them.
export function voiceFromPort(port: VoicePort): VoiceOut {
  return {
    convert: (recording) => fromPromise(() => port.convert(recording.bytes as Blob)),
    upload: (core, audio) => fromPromise(() => port.upload(core, audio as Blob)),
  };
}
