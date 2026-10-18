// The outside world of the chat store core: clock, visibility, storage, the boot API, the
// XMPP factory, the draft stream, the badge and the flags; each app builds these from its
// own adapters (web: `apps/web/src/store/effects/ports.ts`).
import type { Effect } from 'effect';
import type { ChatSummary } from '@zilar/chat-core';
import type { XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';
import type { SessionCheck } from './session-check';

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CoreMe {
  readonly id: string;
  readonly name: string;
  readonly jid?: string | null | undefined;
}

export interface CoreContact {
  readonly jid: string;
  readonly name: string;
}

export interface CoreXmppToken {
  readonly jid: string;
  readonly token: string;
  readonly service: string;
  readonly domain: string;
}

/** The API calls the lifecycle makes. A `/api/chats` entry stays `unknown` here: each
 * app maps it through its own rows. */
export interface CoreApi {
  getMe(): Promise<CoreMe>;
  getChats(): Promise<readonly unknown[]>;
  getContacts(): Promise<readonly CoreContact[]>;
  getXmppToken(): Promise<CoreXmppToken>;
  listChatPrefs?(): Promise<readonly unknown[]>;
  /**
   * Optional: stores the caller's read mark (`PUT /api/chats/:jid/read`); the id must be
   * numeric (an archive id). Best effort: failures are ignored.
   */
  markChatRead?(jid: string, messageId: string): Promise<unknown>;
  /**
   * Optional: confirms this device holds these messages (`PUT /api/chats/:jid/delivered`);
   * the ids are origin ids, 1 to 50 per call. Best effort, and the server ignores the
   * caller's own messages.
   */
  markChatDelivered?(jid: string, originIds: string[]): Promise<unknown>;
  /** Optional: deletes one message from the caller's own copy of a DM (`DELETE
   * /api/chats/:jid/messages/:archiveId`); the id is the archive id. */
  deleteMessageForMe?(jid: string, archiveId: string): Promise<unknown>;
  /** Optional: clears the caller's own copy of a DM's history (`DELETE
   * /api/chats/:jid/history`); the peer's copy is untouched. */
  clearChatHistory?(jid: string): Promise<unknown>;
}

export interface ChatRows {
  summariesFor(entry: unknown): ChatSummary[];
}

export interface Visibility {
  isVisible(): boolean;
  onFocus(handler: () => void): () => void;
}

export type DraftHubEvent =
  | {
      readonly type: 'draft';
      readonly chatJid: string;
      readonly turnId: string;
      readonly text: string;
    }
  | {
      readonly type: 'end';
      readonly chatJid: string;
      readonly turnId: string;
      readonly outcome: 'sent' | 'failed';
    };

export type OpenDraftStream = (onEvent: (event: DraftHubEvent) => void) => () => void;

export interface Notifications {
  syncBadge(chats: readonly ChatSummary[]): void;
  dismissChat(chatId: string): void;
}

export interface StoreFlags {
  connectRetry: boolean;
  reconnectOnResume: boolean;
}

export interface CorePorts {
  readonly now: () => Date;
  readonly isVisible: () => boolean;
  readonly storage: KeyValue | null;
  readonly api: CoreApi;
  readonly rows: ChatRows;
  readonly createXmpp: (options: XmppCoreOptions) => XmppCore;
  readonly visibility: Visibility;
  readonly drafts: OpenDraftStream;
  readonly notifications: Notifications;
  readonly flags: StoreFlags;
  /**
   * Asks `GET /api/me` whether the server session still exists after an `authFailed`:
   * `valid` keeps retrying, `gone` signs out, `unknown` keeps retrying.
   */
  checkSession?(): Promise<SessionCheck>;
  sessionGone?(): void;
}

export interface OutgoingBytesData {
  readonly kind: 'image' | 'file';
  readonly name: string;
  readonly size: number;
  readonly mime: string;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly localUrl?: string | undefined;
}

/** The bytes of an outgoing file: classify, measure, upload with progress and cancel; web
 * has no cancel, mobile returns no size. */
export interface OutgoingBytes {
  describe(file: unknown): OutgoingBytesData;
  measure(file: unknown): Effect.Effect<{ width: number; height: number } | undefined, unknown>;
  upload(
    core: XmppCore,
    file: unknown,
    onProgress: (fraction: number) => void,
    key: string,
  ): Effect.Effect<string, unknown>;
  cancel?(key: string): void;
}

export interface VoiceInput {
  readonly bytes: unknown;
  readonly durationMs: number;
  readonly waveform: number[];
  readonly localUrl?: string | undefined;
}

export interface VoiceOut {
  convert(recording: VoiceInput): Effect.Effect<{ durationMs: number; audio: unknown }, unknown>;
  upload(
    core: XmppCore,
    audio: unknown,
    onProgress: (fraction: number) => void,
    key: string,
  ): Effect.Effect<string, unknown>;
}

export interface SendPorts {
  readonly bytes: OutgoingBytes;
  readonly voice: VoiceOut;
}

const inertApi: CoreApi = {
  getMe: () => {
    throw new Error('core api.getMe is not provided');
  },
  getChats: () => {
    throw new Error('core api.getChats is not provided');
  },
  getContacts: () => {
    throw new Error('core api.getContacts is not provided');
  },
  getXmppToken: () => {
    throw new Error('core api.getXmppToken is not provided');
  },
};

export function testCorePorts(fakes: Partial<CorePorts> = {}): CorePorts {
  return {
    now: fakes.now ?? ((): Date => new Date(0)),
    isVisible: fakes.isVisible ?? ((): boolean => true),
    storage: fakes.storage === undefined ? null : fakes.storage,
    api: fakes.api ?? inertApi,
    rows: fakes.rows ?? { summariesFor: () => [] },
    createXmpp:
      fakes.createXmpp ??
      (() => {
        throw new Error('createXmpp is not provided in this test');
      }),
    visibility: fakes.visibility ?? { isVisible: () => true, onFocus: () => () => {} },
    drafts: fakes.drafts ?? (() => () => {}),
    notifications: fakes.notifications ?? { syncBadge: () => {}, dismissChat: () => {} },
    flags: fakes.flags ?? { connectRetry: true, reconnectOnResume: false },
    ...(fakes.checkSession === undefined ? {} : { checkSession: fakes.checkSession }),
    ...(fakes.sessionGone === undefined ? {} : { sessionGone: fakes.sessionGone }),
  };
}
