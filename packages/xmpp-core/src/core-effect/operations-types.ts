// The shape `createOperations` returns. Split out of `operations.ts` (T-1458) so
// that file stays under the 400-line cap; `operations.ts` re-exports the type, so
// every importer keeps working.
import type { Effect } from 'effect';
import { type NotOnline, type XmppCoreError } from '../errors';
import type {
  ChatKind,
  HistoryPage,
  LoadHistoryOptions,
  SendCorrectionOptions,
  SendMessageOptions,
  UploadRequest,
  UploadSlot,
} from '../types';

export type OperationsApi = {
  joinRoom: (roomJid: string, nick: string) => Effect.Effect<void, XmppCoreError>;
  leaveRoom: (roomJid: string) => Effect.Effect<void>;
  sendMessage: (
    to: string,
    kind: ChatKind,
    text: string,
    opts?: SendMessageOptions,
  ) => Effect.Effect<{ id: string }, NotOnline | Error>;
  sendReactions: (
    chatJid: string,
    kind: ChatKind,
    targetId: string,
    emojis: string[],
  ) => Effect.Effect<void, NotOnline | Error>;
  sendCorrection: (
    chatJid: string,
    kind: ChatKind,
    originalId: string,
    text: string,
    opts?: SendCorrectionOptions,
  ) => Effect.Effect<{ id: string }, NotOnline | Error>;
  sendRetraction: (
    chatJid: string,
    kind: ChatKind,
    targetId: string,
  ) => Effect.Effect<void, NotOnline | Error>;
  loadHistory: (
    chatJid: string,
    kind: ChatKind,
    opts?: LoadHistoryOptions,
  ) => Effect.Effect<HistoryPage, XmppCoreError>;
  requestUploadSlot: (uploadRequest: UploadRequest) => Effect.Effect<UploadSlot, XmppCoreError>;
  setPushEnabled: (pushOptions: {
    pushJid: string;
    node: string;
    enable: boolean;
  }) => Effect.Effect<void, XmppCoreError>;
  sendTyping: (
    to: string,
    kind: ChatKind,
    state: 'composing' | 'paused',
    status?: string,
  ) => Effect.Effect<void>;
  markDisplayed: (chatJid: string, kind: ChatKind, messageId: string) => Effect.Effect<void>;
};
