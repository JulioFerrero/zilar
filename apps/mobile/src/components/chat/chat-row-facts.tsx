import {
  shouldRenderMarkdown,
  type ChatSummary,
  type TopicInfo,
  type UiMessage,
} from '@zilar/chat-core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

import { useChatStore } from '@/store/chat-store-provider';

/** An empty trusted-host set, so an undefined store value stays a stable prop. */
const EMPTY_HOSTS: ReadonlySet<string> = new Set();

/**
 * The chat fields a row reads (T-2009, C5/C6). The full summary gets a new
 * identity on every new message (its preview and unread count change), which
 * must not change the facts and re-render every mounted row, so only these
 * fields are handed down.
 */
export type ChatRowChat = {
  kind: ChatSummary['kind'];
  isAI: ChatSummary['isAI'];
  groupId: string | undefined;
  topic: TopicInfo | undefined;
};

type ChatRowFacts = {
  /** The hostnames an attachment may load from (T-0150). */
  mediaHosts: ReadonlySet<string>;
  /** Whether a message's text renders as Markdown (the shared AI rule). */
  showMarkdown: (message: UiMessage) => boolean;
  meJid: string | undefined;
  chat: ChatRowChat;
};

const ChatRowFactsContext = createContext<ChatRowFacts | null>(null);

/**
 * One set of per-chat store subscriptions for every mounted row (T-2009):
 * the trusted media hosts, my JID and the chat fields, computed once here
 * instead of once per row and per selector. The value is memoised, and the
 * chat is narrowed, so a new message's preview or unread update does not
 * re-render the rows.
 */
export function ChatRowFactsProvider({
  chat,
  currentUserId,
  children,
}: {
  chat: ChatSummary;
  currentUserId: string;
  children: ReactNode;
}) {
  const mediaHosts = useChatStore((state) => state.mediaTrustedHosts) ?? EMPTY_HOSTS;
  const meJid = useChatStore((state) => state.me?.jid ?? undefined);
  // The latest summary, so the Markdown rule sees the current chat without
  // making the memoised value depend on the summary's identity.
  const latestChat = useRef(chat);
  useEffect(() => {
    latestChat.current = chat;
  }, [chat]);
  const showMarkdown = useCallback(
    (message: UiMessage) => shouldRenderMarkdown(latestChat.current, message, currentUserId),
    [currentUserId],
  );
  const rowChat = useMemo<ChatRowChat>(
    () => ({ kind: chat.kind, isAI: chat.isAI, groupId: chat.groupId, topic: chat.topic }),
    [chat.kind, chat.isAI, chat.groupId, chat.topic],
  );
  const value = useMemo<ChatRowFacts>(
    () => ({ mediaHosts, showMarkdown, meJid, chat: rowChat }),
    [mediaHosts, showMarkdown, meJid, rowChat],
  );
  return <ChatRowFactsContext.Provider value={value}>{children}</ChatRowFactsContext.Provider>;
}

/** The per-chat facts a message row reads; must sit under the provider. */
export function useChatRowFacts(): ChatRowFacts {
  const facts = useContext(ChatRowFactsContext);
  if (facts === null) {
    throw new Error('useChatRowFacts must be used inside ChatRowFactsProvider');
  }
  return facts;
}
