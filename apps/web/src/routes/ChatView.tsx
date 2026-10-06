import type { ChatSummary, ReplyRef, UiMessage } from '@zilar/chat-core';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AiPanel } from '@/components/ais/AiPanel';
import { ChannelComposerBar } from '@/components/ChannelComposerBar';
import { ChannelPanel } from '@/components/ChannelPanel';
import { ChatHeader } from '@/components/ChatHeader';
import { Composer } from '@/components/Composer';
import { ForwardPicker } from '@/components/ForwardPicker';
import { Button } from '@/components/ui/button';
import { GroupPanel } from '@/components/GroupPanel';
import { MessageList } from '@/components/MessageList';
import { PinnedBanner } from '@/components/PinnedBanner';
import { PinsPanel } from '@/components/PinsPanel';
import { TaskStrip } from '@/components/TaskStrip';
import { TopicPanel } from '@/components/TopicPanel';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';
import { replyRef } from '@/lib/format';

type OpenPanel = 'ai' | 'group' | 'topic';

function initialPanel(value: string | null, chat: ChatSummary): OpenPanel | undefined {
  if (value === 'ai' && chat.isAI) {
    return 'ai';
  }
  // T-0124: the channel feed opens the channel panel, not the topic panel.
  if (value === 'topic' && chat.topic !== undefined && chat.chatKind !== 'channel') {
    return 'topic';
  }
  if (value === 'group' && chat.kind === 'group' && chat.topic === undefined) {
    return 'group';
  }
  if (value === 'group' && chat.chatKind === 'channel') {
    return 'group';
  }
  return undefined;
}

export function ChatView({ chat }: { chat: ChatSummary }) {
  const storeApi = useChatStoreApi();
  const store = useChatStore();
  const navigate = useNavigate();
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
  const [forwarding, setForwarding] = useState<UiMessage[] | null>(null);
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
  const pinsPanel = store.pinsPanel?.chatId === chat.id ? store.pinsPanel : undefined;

  // Pins load when the chat opens (the store also refreshes them on focus
  // and every 60 s while the chat is open; there is no realtime channel yet).
  useEffect(() => {
    void storeApi.getState().loadPins(chat.id);
  }, [storeApi, chat.id]);

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
      <PinnedBanner chatId={chat.id} />
      {notice !== undefined && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-divider bg-panel px-4 py-2">
          <p role="status" className="text-[13px] text-muted-foreground">
            {notice.message}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Dismiss notice"
            onClick={() => storeApi.getState().dismissTopicNotice()}
            className="shrink-0 rounded-full text-[13px] text-muted-foreground"
          >
            Dismiss
          </Button>
        </div>
      )}
      <MessageList
        key={chat.id}
        chat={chat}
        onReply={startReply}
        onForward={(message) => setForwarding([message])}
      />
      {chat.chatKind === 'channel' ? (
        <ChannelComposerBar chat={chat} />
      ) : (
        <Composer
          chatId={chat.id}
          replyTo={replyTo}
          onCancelReply={cancelReply}
          onOpenStickersSettings={() => navigate('/settings/stickers')}
        />
      )}
      {panel === 'ai' && chat.isAI && <AiPanel chat={chat} onClose={() => setPanel(undefined)} />}
      {panel === 'group' && chat.kind === 'group' && chat.topic === undefined && (
        <GroupPanel chat={chat} onClose={() => setPanel(undefined)} />
      )}
      {panel === 'topic' && chat.topic !== undefined && chat.chatKind !== 'channel' && (
        <TopicPanel chat={chat} onClose={() => setPanel(undefined)} />
      )}
      {panel === 'group' && chat.chatKind === 'channel' && (
        <ChannelPanel chat={chat} onClose={() => setPanel(undefined)} />
      )}
      {pinsPanel !== undefined && (
        <PinsPanel chatId={chat.id} onClose={() => storeApi.getState().setPinsPanel(undefined)} />
      )}
      {forwarding !== null && (
        <ForwardPicker messages={forwarding} onClose={() => setForwarding(null)} />
      )}
    </div>
  );
}
