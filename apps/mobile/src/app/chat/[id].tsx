import {
  formatTime,
  isTopicJoined,
  liveStageFor,
  senderColor,
  topicActivityLine,
  topicActivityView,
  type ChatSummary,
  type UiMessage,
} from '@zilar/chat-core';
import { isValid, PayloadSchema } from '@zilar/protocol';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { FlatList, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RequireAuth } from '@/auth/RequireAuth';
import { ChatComposerDock } from '@/components/chat/chat-composer-dock';
import { ChatThread } from '@/components/chat/chat-thread';
import { composerBarFor } from '@/components/chat/composer-mentions';
import { PinnedBanner } from '@/components/chat/pinned-banner';
import { MessageListSkeleton } from '@/components/chat/skeleton';
import { TopicInfoHost } from '@/components/chat/topic-info-host';
import { useChatScreen, type ChatScreen } from '@/components/chat/use-chat-screen';
import { rawCall } from '@/components/chat/group-action';
import { PayloadCard } from '@/components/chat/payload-card';
import { StateMessage } from '@/components/ui/state-message';
import { goBackOrHome } from '@/lib/navigation';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';
import { chatGrid } from '@zilar/ui-tokens';
import { ChatHeader } from '@/components/chat/chat-header';
import { Effect } from 'effect';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text, TextField } from '@/components/ui/text';
import { useChatStore } from '@/store/chat-store-provider';
import { useEffect, useRef, useState } from 'react';
import { MediaSheet } from '@/components/chat/media-sheet';
import { PinsSheet } from '@/components/chat/pins-sheet';
import type { BannerPin } from '@/components/chat/pinned-banner';
import { runInBackground } from '@/lib/effect/run-in-background';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { bubbleStyle } from '@/lib/depth';
import type { TopicPreviewMessage } from '@/lib/topics-api';
import { ChatPickerList } from '@/components/chat/chat-picker-list';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';

function forwardSendLabel(count: number): string {
  return count > 1 ? `Send to ${count} chats` : 'Send';
}

function ForwardSheet({ messages, onClose }: { messages: UiMessage[]; onClose: () => void }) {
  const chats = useChatStore((state) => state.chats);
  const forwardMessages = useChatStore((state) => state.forwardMessages);
  const [selected, setSelected] = useState<string[]>([]);
  const [comment, setComment] = useState('');

  const toggle = (chatId: string): void => {
    setSelected((current) =>
      current.includes(chatId) ? current.filter((id) => id !== chatId) : [...current, chatId],
    );
  };

  const send = (): void => {
    if (selected.length === 0) {
      return;
    }
    const trimmed = comment.trim();
    forwardMessages(selected, messages, trimmed === '' ? undefined : { comment: trimmed });
    onClose();
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      closeLabel="Close forward"
      title="Forward"
      footer={
        <Button disabled={selected.length === 0} onPress={send}>
          <Text>{forwardSendLabel(selected.length)}</Text>
        </Button>
      }
    >
      <ChatPickerList chats={chats} selected={selected} onToggle={toggle} mode="multi" />
      <View className="mt-3">
        <TextField
          label="Add a comment (optional)"
          value={comment}
          onChangeText={setComment}
          multiline
        />
      </View>
    </BottomSheet>
  );
}

type ChatOverlaysProps = {
  screen: ChatScreen;
  chat: ChatSummary;
};

function ChatOverlays({ screen, chat }: ChatOverlaysProps) {
  const canPinChat = useChatStore((state) => state.canPin(chat.id));
  const unpinMessage = useChatStore((state) => state.unpinMessage);
  const [unpinningId, setUnpinningId] = useState<string | null>(null);
  const [pinsSheetError, setPinsSheetError] = useState('');

  const sheetUnpin = (pin: BannerPin) => {
    setUnpinningId(pin.id);
    setPinsSheetError('');
    runInBackground(() => unpinMessage(chat.id, pin.id), {
      onFailure: () => setPinsSheetError('Could not unpin. Try again.'),
      onSettled: () => setUnpinningId(null),
    });
  };

  return (
    <>
      <PinsSheet
        open={screen.pinsOpen}
        pins={screen.pins}
        canUnpin={canPinChat}
        unpinningId={unpinningId}
        error={pinsSheetError}
        onUnpin={sheetUnpin}
        onJump={screen.jumpToPin}
        onClose={() => screen.setPinsOpen(false)}
      />
      {screen.forwarding !== null ? (
        <ForwardSheet messages={screen.forwarding} onClose={() => screen.setForwarding(null)} />
      ) : null}
      {screen.mediaOpen ? (
        <MediaSheet
          chatId={chat.id}
          title="Media, files and links"
          onJump={screen.jumpTo}
          onClose={() => screen.setMediaOpen(false)}
        />
      ) : null}
    </>
  );
}

function AiStatusLine({ chat }: { chat: ChatSummary }) {
  const messages = useChatStore((state) => state.messagesByChat[chat.id]);
  const openAtMessage = useChatStore((state) => state.openAtMessage);
  const topic = chat.topic;
  const entries = topic === undefined ? [] : topicActivityView(topic.activity, topic.doneAt).active;
  const first = entries[0];
  if (first === undefined) {
    return null;
  }
  const stage = liveStageFor(messages, first.jid);
  const text =
    first.state === 'working' && stage !== undefined
      ? `· ${stage}`
      : topicActivityLine(first.state);
  const extra = entries.length - 1;
  const openQuestion = (messageId: string): void => {
    Effect.runFork(
      Effect.tryPromise({
        try: () => openAtMessage(chat.id, messageId),
        catch: (cause) => cause,
      }).pipe(Effect.ignore),
    );
  };
  const questionId = first.questionId;
  return (
    <View
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      className="max-w-full flex-row items-center gap-1.5 rounded-full border border-divider bg-surface-raised px-3 py-1"
    >
      <EntityAvatar
        person={{ id: first.aiId, name: first.name, avatarUrl: first.avatarUrl }}
        size={16}
        ai
      />
      <Text numberOfLines={1} className="min-w-0 shrink text-[13px] text-muted-foreground">
        {first.state === 'waiting' && questionId !== undefined ? (
          <Text className="text-foreground" onPress={() => openQuestion(questionId)}>
            {first.name}
          </Text>
        ) : (
          <Text className="text-foreground">{first.name}</Text>
        )}{' '}
        {text}
      </Text>
      {extra > 0 ? (
        <Text className="shrink-0 font-mono text-[13px] text-muted-foreground">+{extra}</Text>
      ) : null}
    </View>
  );
}

type ChatHeaderBarProps = {
  chat: ChatSummary;
  onBack: () => void;
  onSearchInChat: () => void;
  onOpenMedia: () => void;
  onOpenGroup?: (groupId: string) => void;
  topicGroupName?: string;
  onOpenInfo?: () => void;
};

function ChatHeaderBar({
  chat,
  onBack,
  onSearchInChat,
  onOpenMedia,
  onOpenGroup,
  topicGroupName,
  onOpenInfo,
}: ChatHeaderBarProps) {
  return (
    <SafeAreaView edges={['top']} className="bg-surface">
      <ChatHeader
        chat={chat}
        onBack={onBack}
        onSearchInChat={onSearchInChat}
        onOpenMedia={onOpenMedia}
        topicGroupName={topicGroupName}
        onOpenInfo={onOpenInfo}
        onOpenGroup={onOpenGroup}
      />
    </SafeAreaView>
  );
}

/** Black chat background with the 22 px dot grid (ui-style.md §2). */
function ChatBackground() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <Pattern
          id="zilar-dots"
          x="0"
          y="0"
          width={chatGrid.cell}
          height={chatGrid.cell}
          patternUnits="userSpaceOnUse"
        >
          <Circle
            cx={chatGrid.dotRadius}
            cy={chatGrid.dotRadius}
            r={chatGrid.dotRadius}
            fill={chatGrid.dot}
          />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={chatGrid.background} />
      <Rect width="100%" height="100%" fill="url(#zilar-dots)" />
    </Svg>
  );
}

export default function ChatScreen() {
  return (
    <RequireAuth>
      <Chat />
    </RequireAuth>
  );
}

function Chat() {
  const screen = useChatScreen();
  const { chat, chatsLoad } = screen;

  if (!chat) {
    // The chats are still arriving: this is a loading state, not "not found".
    if (chatsLoad === 'loading') {
      return (
        <SafeAreaView className="flex-1 bg-background" edges={['top']}>
          <ChatBackground />
          <MessageListSkeleton />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background" edges={['top']}>
        <StateMessage
          kind="empty"
          title="Chat not found"
          hint="It may have been deleted or you left it."
          action={{
            label: 'Back to chats',
            onPress: () => goBackOrHome(screen.router),
            accessibilityLabel: 'Back to chats',
          }}
        />
      </SafeAreaView>
    );
  }

  const {
    isTopic,
    router,
    pins,
    pinsError,
    pinIndex,
    setPinIndex,
    jumpError,
    setJumpError,
    jumpToPin,
    setPinsOpen,
    dismissPinsError,
    setMediaOpen,
    groupName,
    openInfo,
    openGroup,
  } = screen;

  // A public topic the caller has not joined shows its recent messages read-only with one Join key; an unknown caller id or member list keeps the normal thread.
  const joinPreview =
    chat.topic !== undefined &&
    chat.topic.visibility === 'public' &&
    !chat.topic.isGeneral &&
    screen.myUserId !== '' &&
    chat.topic.memberIds !== undefined &&
    !isTopicJoined(chat.topic, screen.myUserId);

  const headerProps = {
    chat,
    onBack: () => goBackOrHome(router),
    onSearchInChat: () => router.push({ pathname: '/', params: { searchChat: chat.id } }),
    onOpenMedia: () => setMediaOpen(true),
    onOpenGroup: openGroup,
  };

  const pinnedBanner = (
    <PinnedBanner
      pins={pins}
      pinsError={pinsError}
      index={Math.min(pinIndex, Math.max(pins.length - 1, 0))}
      jumpError={jumpError}
      onCycle={() => {
        setJumpError('');
        setPinIndex((value) => (pins.length === 0 ? 0 : (value + 1) % pins.length));
      }}
      onTapPin={jumpToPin}
      onOpenList={() => setPinsOpen(true)}
      onDismissError={() => dismissPinsError()}
    />
  );

  if (!isTopic || chat.chatKind === 'channel') {
    const legacyComposer = composerBarFor(chat) === 'composer';
    const variant =
      chat.chatKind === 'channel' ? 'channel' : legacyComposer ? 'composer' : 'channel';
    return (
      <View className="flex-1 bg-background">
        <ChatBackground />
        <ChatHeaderBar {...headerProps} />
        {pinnedBanner}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ChatThread screen={screen} chat={chat} />
          <ChatComposerDock screen={screen} chat={chat} variant={variant} />
        </KeyboardAvoidingView>
        <ChatOverlays screen={screen} chat={chat} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ChatBackground />
      <ChatHeaderBar {...headerProps} topicGroupName={groupName} onOpenInfo={openInfo} />
      {pinnedBanner}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {joinPreview ? (
          <TopicJoinView key={chat.id} chat={chat} />
        ) : (
          <>
            <View className="flex-1">
              <ChatThread screen={screen} chat={chat} />
              <View
                pointerEvents="box-none"
                className="absolute bottom-1.5 left-0 right-0 items-center px-3"
              >
                <AiStatusLine chat={chat} />
              </View>
            </View>
            <ChatComposerDock screen={screen} chat={chat} variant="composer" />
          </>
        )}
      </KeyboardAvoidingView>
      <TopicInfoHost screen={screen} chat={chat} />
      <ChatOverlays screen={screen} chat={chat} />
    </View>
  );
}

const LOAD_ERROR = 'Could not load messages. Try again.';
const JOIN_ERROR = 'Could not join the topic. Try again.';

type PreviewState =
  { kind: 'loading' } | { kind: 'ready'; messages: TopicPreviewMessage[] } | { kind: 'error' };

/** `18:02` for a preview stamp; an unparsable stamp shows no time. */
function previewTime(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : formatTime(date);
}

// A public topic the caller has not joined: its recent messages, read-only, with one "Join {title}" key where the composer sits. Joining runs the store action, whose answer repaints the row and swaps this view for the thread.
function TopicJoinView({ chat }: { chat: ChatSummary }) {
  const joinTopic = useChatStore((state) => state.joinTopic);
  // The preview lives on the mock-aware topics port; the store action resolves the topic id behind this chat row first.
  const topicPreview = useChatStore((state) => state.topicPreview);
  // The screen remounts this view with a key per topic, so this id is fixed for the mount; a result for anything else is ignored.
  const mountedChatId = useRef(chat.id);
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [joinState, join] = useAction(() => rawCall(() => joinTopic(chat.id)));
  const joining = isWaiting(joinState);
  const joinError = !joining && failureOf(joinState) !== undefined ? JOIN_ERROR : '';

  useEffect(() => {
    let active = true;
    runInBackground(() => topicPreview(chat.id), {
      onSuccess: (messages) => {
        if (active && chat.id === mountedChatId.current) {
          setState({ kind: 'ready', messages });
        }
      },
      onFailure: () => {
        if (active && chat.id === mountedChatId.current) {
          setState({ kind: 'error' });
        }
      },
    });
    return () => {
      active = false;
    };
  }, [topicPreview, chat.id, attempt]);

  return (
    <View className="flex-1">
      {state.kind === 'loading' ? (
        <View className="flex-1 justify-end">
          <StateMessage kind="loading" title="Loading messages…" />
        </View>
      ) : state.kind === 'error' ? (
        <View className="flex-1 justify-end">
          <StateMessage
            kind="error"
            title={LOAD_ERROR}
            action={{
              label: 'Retry',
              onPress: () => {
                setState({ kind: 'loading' });
                setAttempt((value) => value + 1);
              },
            }}
          />
        </View>
      ) : state.messages.length === 0 ? (
        <View className="flex-1 justify-end">
          <StateMessage
            kind="empty"
            title="No messages yet."
            hint={`Join ${chat.title} to see new messages here.`}
          />
        </View>
      ) : (
        <FlatList
          data={state.messages}
          keyExtractor={(message) => message.id}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'flex-end',
            gap: 10,
            paddingHorizontal: 14,
            paddingVertical: 16,
          }}
          renderItem={({ item }) => {
            // A preview row may carry the decoded `<agent>` payload with an empty body; only display-only cards are drawn (no sender to check, no respond target), and a row with neither card nor text is skipped.
            const payload = isValid(PayloadSchema)(item.payload) ? item.payload : undefined;
            const card =
              payload !== undefined && (payload.type === 'blocks' || payload.type === 'progress')
                ? payload
                : undefined;
            if (card === undefined && item.body === '') {
              return null;
            }
            const time = (
              <Text className="self-end font-mono text-[10px] text-muted-foreground">
                {previewTime(item.at)}
              </Text>
            );
            const senderName = (
              <Text
                numberOfLines={1}
                className="mb-0.5 text-[12px] font-semibold"
                color={senderColor(item.nick)}
              >
                {item.nick}
              </Text>
            );
            return (
              <View className="max-w-[85%] flex-row items-end gap-2 self-start">
                <EntityAvatar person={{ id: item.nick, name: item.nick }} size={28} />
                {card !== undefined ? (
                  // Blocks and progress cards carry their own surface, like the thread: no bubble around them.
                  <View className="shrink">
                    {senderName}
                    <PayloadCard
                      card={card}
                      footer={card.type === 'blocks' ? time : undefined}
                      preview
                    />
                  </View>
                ) : (
                  <View className="rounded-[14px] px-3 py-2" style={bubbleStyle('incoming', true)}>
                    {senderName}
                    <Text className="text-[15px] leading-[21px] text-foreground">{item.body}</Text>
                    {time}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      <View className="border-t border-border px-4 pb-[30px] pt-3">
        {joinError !== '' ? (
          <Text accessibilityRole="alert" className="pb-2 text-center text-[13px] text-danger">
            {joinError}
          </Text>
        ) : null}
        <Button
          variant="key"
          accessibilityLabel={`Join ${chat.title}`}
          disabled={joining}
          className="h-10 w-full rounded-[12px]"
          onPress={() => join(undefined)}
        >
          <Text className="text-[15px] font-semibold">
            {joining ? 'Joining…' : `Join ${chat.title}`}
          </Text>
        </Button>
      </View>
    </View>
  );
}
