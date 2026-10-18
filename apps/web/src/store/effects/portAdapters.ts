// The browser-backed port adapters of the web chat store; ports.ts composes them in
// resolvePorts, and this module imports types from ./ports only, so there is no cycle.
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
  if (typeof document === 'undefined') {
    return true;
  }
  // Page visibility is not enough: a visible but unfocused window (a second monitor) must
  // not mark messages seen. jsdom's document is prerender and unfocused, so treat it as visible.
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')) {
    return true;
  }
  return document.visibilityState === 'visible' && document.hasFocus();
}

export function defaultOnFocus(handler: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  // Coming back into focus clears the open chat's unread; listen on both visibilitychange and
  // focus so a visible-but-unfocused window marks seen when it is clicked into.
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      handler();
    }
  };
  window.addEventListener('focus', handler);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('focus', handler);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

export const realRows: ChatRows = {
  summariesFor: (entry) => summariesFor(entry as ChatEntry),
};

export const webFlags: StoreFlags = { connectRetry: true, reconnectOnResume: false };

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

// URL.createObjectURL is missing in some test environments.
function objectUrlFor(blob: Blob): string | undefined {
  return Effect.runSync(
    Effect.try(() => URL.createObjectURL(blob)).pipe(Effect.orElseSucceed(() => undefined)),
  );
}

// The core bytes port over web's attachment port: classification, image size and the
// XEP-0363 upload. Web has no cancel and ignores progress.
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

// The core voice port over web's voice port; the recording's bytes are opaque to the core.
export function voiceFromPort(port: VoicePort): VoiceOut {
  return {
    convert: (recording) => fromPromise(() => port.convert(recording.bytes as Blob)),
    upload: (core, audio) => fromPromise(() => port.upload(core, audio as Blob)),
  };
}
