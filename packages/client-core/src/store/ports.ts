// The outside world of the chat store core: the clock, whether the user can see
// the app, the key-value storage, the API the lifecycle boots with, the XMPP
// factory, the AI draft stream, the app badge and the behaviour flags. Each app
// builds these from its own adapters (web: `apps/web/src/store/effects/ports.ts`).
import type { ChatSummary } from '@zilar/chat-core';
import type { XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';

/** Synchronous key-value storage (`localStorage` on web), or none. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What the lifecycle reads of the signed-in user. */
export interface CoreMe {
  readonly id: string;
  readonly name: string;
  readonly jid?: string | null | undefined;
}

/** What the lifecycle reads of a contact. */
export interface CoreContact {
  readonly jid: string;
  readonly name: string;
}

/** What the lifecycle reads of an XMPP token. */
export interface CoreXmppToken {
  readonly jid: string;
  readonly token: string;
  readonly service: string;
  readonly domain: string;
}

/**
 * The API calls the lifecycle makes. A `/api/chats` entry stays `unknown`
 * here: each app maps it through `rows` (the app's own `ChatEntry`).
 */
export interface CoreApi {
  getMe(): Promise<CoreMe>;
  getChats(): Promise<readonly unknown[]>;
  getContacts(): Promise<readonly CoreContact[]>;
  getXmppToken(): Promise<CoreXmppToken>;
  /** Optional: an app without it reads no prefs (mobile `chatPrefs` is optional). */
  listChatPrefs?(): Promise<readonly unknown[]>;
}

/** How an app maps its own `/api/chats` entry to the shared chat summaries. */
export interface ChatRows {
  summariesFor(entry: unknown): ChatSummary[];
}

/** True while the user can see the app, plus a focus subscription. */
export interface Visibility {
  isVisible(): boolean;
  /** Window focus on web, AppState `active` on mobile. Returns the unsubscribe. */
  onFocus(handler: () => void): () => void;
}

/** One live AI draft event from the drafts stream. */
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

/** Opens the draft stream; the returned function closes it. */
export type OpenDraftStream = (onEvent: (event: DraftHubEvent) => void) => () => void;

/** The app badge and the push notifications; both are best effort. */
export interface Notifications {
  syncBadge(chats: readonly ChatSummary[]): void;
  dismissChat(chatId: string): void;
}

/** Behaviour switches that differ per app (plan section 4, R7/R8). */
export interface StoreFlags {
  /** Retry the connection after a failure with growing waits (R7). */
  connectRetry: boolean;
  /** Reconnect when the app becomes visible again (R8, mobile). */
  reconnectOnResume: boolean;
}

export interface CorePorts {
  readonly now: () => Date;
  /** True while the user can see the app: the tab is visible, the app is active. */
  readonly isVisible: () => boolean;
  /** Where the last-read map is saved, or null to keep it in memory only. */
  readonly storage: KeyValue | null;
  readonly api: CoreApi;
  readonly rows: ChatRows;
  readonly createXmpp: (options: XmppCoreOptions) => XmppCore;
  readonly visibility: Visibility;
  readonly drafts: OpenDraftStream;
  readonly notifications: Notifications;
  readonly flags: StoreFlags;
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

/** The ports of a core test: a fixed clock, a visible app, no storage or app
 * adapters, unless supplied. */
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
  };
}
