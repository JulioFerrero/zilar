import type { ChatSummary, ReplyRef, UiMessage } from '@galena/chat-core';
import { useEffect, useState } from 'react';
import { ChatHeader } from '@/components/ChatHeader';
import { Composer } from '@/components/Composer';
import { MessageList } from '@/components/MessageList';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';
import { replyRef } from '@/lib/format';

export function ChatView({ chat }: { chat: ChatSummary }) {
  const storeApi = useChatStoreApi();
  const store = useChatStore();
  const [replyTo, setReplyTo] = useState<ReplyRef | undefined>(undefined);

  useEffect(() => {
    storeApi.getState().openChat(chat.id);
  }, [storeApi, chat.id]);

  const startReply = (message: UiMessage): void => {
    setReplyTo(replyRef(message, store.currentUserId));
  };

  const cancelReply = (): void => {
    setReplyTo(undefined);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader chat={chat} />
      <MessageList key={chat.id} chat={chat} onReply={startReply} />
      <Composer chatId={chat.id} replyTo={replyTo} onCancelReply={cancelReply} />
    </div>
  );
}
