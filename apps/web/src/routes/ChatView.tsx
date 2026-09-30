import type { ChatSummary, ReplyRef, UiMessage } from '@galena/chat-core';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AiPanel } from '@/components/ais/AiPanel';
import { ChatHeader } from '@/components/ChatHeader';
import { Composer } from '@/components/Composer';
import { GroupPanel } from '@/components/GroupPanel';
import { MessageList } from '@/components/MessageList';
import { TaskStrip } from '@/components/TaskStrip';
import { TopicPanel } from '@/components/TopicPanel';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';
import { replyRef } from '@/lib/format';

type OpenPanel = 'ai' | 'group' | 'topic';

function initialPanel(value: string | null, chat: ChatSummary): OpenPanel | undefined {
  if (value === 'ai' && chat.isAI) {
    return 'ai';
  }
  if (value === 'topic' && chat.topic !== undefined) {
    return 'topic';
  }
  if (value === 'group' && chat.kind === 'group' && chat.topic === undefined) {
    return 'group';
  }
  return undefined;
}

export function ChatView({ chat }: { chat: ChatSummary }) {
  const storeApi = useChatStoreApi();
  const store = useChatStore();
  const [searchParams] = useSearchParams();
  const [panel, setPanel] = useState<OpenPanel | undefined>(() =>
    initialPanel(searchParams.get('panel'), chat),
  );
  // Switching chats closes the open panel, unless the new URL still asks for
  // one. ChatShell keys ChatView by chat id, but the reset is explicit so the
  // panel can never leak from one chat to the next.
  const [panelChatId, setPanelChatId] = useState(chat.id);
  if (panelChatId !== chat.id) {
    setPanelChatId(chat.id);
    setPanel(initialPanel(searchParams.get('panel'), chat));
  }
  const [replyTo, setReplyTo] = useState<ReplyRef | undefined>(undefined);
  const editTarget = store.editTarget;
  // Edit mode and reply are exclusive: starting an edit clears the reply. The
  // reset happens during render (React's "adjust state when a prop changes"),
  // like the composer's chat-switch reset.
  const [lastEditTarget, setLastEditTarget] = useState(editTarget);
  if (editTarget !== lastEditTarget) {
    setLastEditTarget(editTarget);
    if (editTarget !== undefined) {
      setReplyTo(undefined);
    }
  }

  useEffect(() => {
    storeApi.getState().openChat(chat.id);
  }, [storeApi, chat.id]);

  const startReply = (message: UiMessage): void => {
    storeApi.getState().cancelEdit();
    setReplyTo(replyRef(message, store.currentUserId));
  };

  const cancelReply = (): void => {
    setReplyTo(undefined);
  };

  const notice = store.topicNotice?.chatId === chat.id ? store.topicNotice : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader
        chat={chat}
        {...(chat.isAI ? { onOpenAiPanel: () => setPanel('ai') } : {})}
        {...(chat.kind === 'group' && chat.topic === undefined
          ? { onOpenGroupPanel: () => setPanel('group') }
          : {})}
        {...(chat.topic !== undefined ? { onOpenTopicPanel: () => setPanel('topic') } : {})}
      />
      {chat.topic !== undefined && <TaskStrip chat={chat} />}
      {notice !== undefined && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-divider bg-panel px-4 py-2">
          <p role="status" className="text-[13px] text-muted-foreground">
            {notice.message}
          </p>
          <button
            type="button"
            aria-label="Dismiss notice"
            onClick={() => storeApi.getState().dismissTopicNotice()}
            className="shrink-0 rounded-full px-2 py-1 text-[13px] text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Dismiss
          </button>
        </div>
      )}
      <MessageList key={chat.id} chat={chat} onReply={startReply} />
      <Composer chatId={chat.id} replyTo={replyTo} onCancelReply={cancelReply} />
      {panel === 'ai' && chat.isAI && <AiPanel chat={chat} onClose={() => setPanel(undefined)} />}
      {panel === 'group' && chat.kind === 'group' && chat.topic === undefined && (
        <GroupPanel chat={chat} onClose={() => setPanel(undefined)} />
      )}
      {panel === 'topic' && chat.topic !== undefined && (
        <TopicPanel chat={chat} onClose={() => setPanel(undefined)} />
      )}
    </div>
  );
}
