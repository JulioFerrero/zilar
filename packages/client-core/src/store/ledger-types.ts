import type {
  ChatSummary,
  EditAuthor,
  EditsState,
  MediaTokenShape,
  ReactionsState,
  UiMessage,
} from '@zilar/chat-core';
import type { Payload } from '@zilar/protocol';
import type { ChatMessage } from '@zilar/xmpp-core';

export type LedgerStanza = Omit<ChatMessage, 'kind'>;

/** A stored chat message: the shared `UiMessage` plus mobile's local-only upload state;
 * web never sets the two upload fields. */
export type StoreMessage = UiMessage & {
  localUri?: string | undefined;
  uploadProgress?: number | undefined;
};

export interface LedgerContact {
  readonly jid: string;
  readonly name: string;
}

export interface LedgerState {
  readonly messagesByChat: Readonly<Record<string, StoreMessage[]>>;
  readonly chats: ChatSummary[];
  readonly edits: Record<string, EditsState>;
  readonly reactions: Record<string, ReactionsState>;
  readonly contacts: readonly LedgerContact[];
  readonly me?: { readonly jid?: string | null | undefined } | null | undefined;
}

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
  readonly memberName: (chatId: string, localpart: string) => string | undefined;
  readonly occupantNick: (chatId: string, fromJid: string) => string | undefined;
  readonly mediaToken: () => MediaTokenShape | undefined;
}

/**
 * The message id that first claimed an origin id in one chat, and its sender: a resend
 * aliases to the first, but another sender's reused origin id must not.
 */
export interface OriginClaim {
  readonly sender: string;
  readonly root: string;
}

/**
 * The card a correction replaces its target with: the payload, the author the update must
 * come from, and the stanza order that decides the newest.
 */
export interface CardEdit {
  readonly order: number;
  readonly author: EditAuthor;
  readonly payload: Payload;
}

export interface LedgerMaps {
  readonly aliases: Map<string, string>;
  readonly serverIds: Map<string, string>;
  readonly originIds: Map<string, string>;
  readonly originClaims: Map<string, OriginClaim>;
  readonly authors: Map<string, EditAuthor>;
  readonly baseTexts: Map<string, string>;
  readonly cards: Map<string, CardEdit>;
}
