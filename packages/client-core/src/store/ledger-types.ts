// The shapes the message ledger works with: the stanza it reads, the message it
// stores, the slice of store state it reads and writes, the callbacks it needs
// from its store, and the id side tables it keeps. Moved unchanged from
// `store/ledger.ts` (size split).
import type {
  ChatSummary,
  EditAuthor,
  EditsState,
  MediaTokenShape,
  ReactionsState,
  UiMessage,
} from '@zilar/chat-core';
import type { ChatMessage } from '@zilar/xmpp-core';

/** A received stanza as the ledger reads it: `ChatMessage` without `kind`, which it never reads. */
export type LedgerStanza = Omit<ChatMessage, 'kind'>;

/**
 * A stored chat message: the shared `UiMessage` plus mobile's local-only
 * upload state (`apps/mobile/src/lib/types.ts` `MobileMessage`). Web never
 * sets the two upload fields, so its messages pass through unchanged.
 */
export type StoreMessage = UiMessage & {
  localUri?: string | undefined;
  uploadProgress?: number | undefined;
};

export interface LedgerContact {
  readonly jid: string;
  readonly name: string;
}

/** The part of a store's state the ledger reads; both apps' states satisfy it. */
export interface LedgerState {
  readonly messagesByChat: Readonly<Record<string, StoreMessage[]>>;
  readonly chats: ChatSummary[];
  readonly edits: Record<string, EditsState>;
  readonly reactions: Record<string, ReactionsState>;
  readonly contacts: readonly LedgerContact[];
  readonly me?: { readonly jid?: string | null | undefined } | null | undefined;
}

/** The part of a store's state the ledger writes. */
export interface LedgerPatch {
  messagesByChat?: Record<string, StoreMessage[]>;
  chats?: ChatSummary[];
  edits?: Record<string, EditsState>;
  reactions?: Record<string, ReactionsState>;
}

export type LedgerSet = (update: LedgerPatch | ((state: LedgerState) => LedgerPatch)) => void;

export interface MessageLedgerDeps {
  readonly get: () => LedgerState;
  readonly set: LedgerSet;
  /** The group member name behind a lowercased user id, in one chat. */
  readonly memberName: (chatId: string, localpart: string) => string | undefined;
  /** The MUC nick of a room occupant (by real or room JID), when connected. */
  readonly occupantNick: (chatId: string, fromJid: string) => string | undefined;
  /** The XMPP token of the latest session, for the media allow-list. */
  readonly mediaToken: () => MediaTokenShape | undefined;
}

/**
 * The id side tables the ledger keeps for a store's lifetime: the optimistic
 * local id to server id aliases, the resolved server ids, the sender-generated
 * origin ids, the authors as their stanzas described them, and the base texts a
 * reverted edit restores. They are created by `createMessageLedger` and shared
 * with the moved id module.
 */
export interface LedgerMaps {
  readonly aliases: Map<string, string>;
  readonly serverIds: Map<string, string>;
  readonly originIds: Map<string, string>;
  readonly authors: Map<string, EditAuthor>;
  readonly baseTexts: Map<string, string>;
}
