import type { ChatSummary } from '@galena/chat-core';
import { useEffect } from 'react';
import { ChatHeader } from '@/components/ChatHeader';
import { Composer } from '@/components/Composer';
import { MessageList } from '@/components/MessageList';
import { useChatStoreApi } from '@/store/ChatStoreProvider';

export function ChatView({ chat }: { chat: ChatSummary }) {
  const storeApi = useChatStoreApi();

  useEffect(() => {
    storeApi.getState().openChat(chat.id);
  }, [storeApi, chat.id]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader chat={chat} />
      <MessageList key={chat.id} chat={chat} />
      <Composer chatId={chat.id} />
    </div>
  );
}
