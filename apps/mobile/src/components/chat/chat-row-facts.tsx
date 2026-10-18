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

/** Only the fields a row reads: the summary's identity changes on every new
 *  message and must not re-render every mounted row. */
export type ChatRowChat = {
  kind: ChatSummary['kind'];
  isAI: ChatSummary['isAI'];
  groupId: string | undefined;
  topic: TopicInfo | undefined;
};

type ChatRowFacts = {
  mediaHosts: ReadonlySet<string>;
  showMarkdown: (message: UiMessage) => boolean;
  meJid: string | undefined;
  chat: ChatRowChat;
};

const ChatRowFactsContext = createContext<ChatRowFacts | null>(null);

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

export function useChatRowFacts(): ChatRowFacts {
  const facts = useContext(ChatRowFactsContext);
  if (facts === null) {
    throw new Error('useChatRowFacts must be used inside ChatRowFactsProvider');
  }
  return facts;
}
