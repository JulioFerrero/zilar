import type { ChatSummary, ReplyRef, UiMessage } from '@galena/chat-core';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AiPanel } from '@/components/ais/AiPanel';
import { ChatHeader } from '@/components/ChatHeader';
import { Composer } from '@/components/Composer';
import { GroupPanel } from '@/components/GroupPanel';
import { MessageList } from '@/components/MessageList';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';
import { replyRef } from '@/lib/format';

type OpenPanel = 'ai' | 'group';

function initialPanel(value: string | null): OpenPanel | undefined {
  return value === 'ai' || value === 'group' ? value : undefined;
}

export function ChatView({ chat }: { chat: ChatSummary }) {
  const storeApi = useChatStoreApi();
  const store = useChatStore();
  const [searchParams] = useSearchParams();
  const [panel, setPanel] = useState<OpenPanel | undefined>(() =>
    initialPanel(searchParams.get('panel')),
  );
  // Switching chats closes the open panel, unless the new URL still asks for
  // one. ChatShell keys ChatView by chat id, but the reset is explicit so the
  // panel can never leak from one chat to the next.
  const [panelChatId, setPanelChatId] = useState(chat.id);
  if (panelChatId !== chat.id) {
    setPanelChatId(chat.id);
    setPanel(initialPanel(searchParams.get('panel')));
  }
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
      <ChatHeader
        chat={chat}
        {...(chat.isAI ? { onOpenAiPanel: () => setPanel('ai') } : {})}
        {...(chat.kind === 'group' ? { onOpenGroupPanel: () => setPanel('group') } : {})}
      />
      <MessageList key={chat.id} chat={chat} onReply={startReply} />
      <Composer chatId={chat.id} replyTo={replyTo} onCancelReply={cancelReply} />
      {panel === 'ai' && chat.isAI && <AiPanel chat={chat} onClose={() => setPanel(undefined)} />}
      {panel === 'group' && chat.kind === 'group' && (
        <GroupPanel chat={chat} onClose={() => setPanel(undefined)} />
      )}
    </div>
  );
}
