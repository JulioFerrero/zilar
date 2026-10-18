import {
  isTopicJoined,
  liveStageFor,
  topicActivityLine,
  topicActivityView,
  type ChatSummary,
  type UiMessage,
} from '@zilar/chat-core';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RequireAuth } from '@/auth/RequireAuth';
import { ChatComposerDock } from '@/components/chat/chat-composer-dock';
import { ChatThread } from '@/components/chat/chat-thread';
import { composerBarFor } from '@/components/chat/composer-mentions';
import { PinnedBanner } from '@/components/chat/pinned-banner';
import { MessageListSkeleton } from '@/components/chat/skeleton';
import { TopicInfoHost } from '@/components/chat/topic-info-host';
import { TopicJoinView } from '@/components/chat/topic-join-view';
import { useChatScreen, type ChatScreen } from '@/components/chat/use-chat-screen';
import { StateMessage } from '@/components/ui/state-message';
import { goBackOrHome } from '@/lib/navigation';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';
import { chatGrid } from '@zilar/ui-tokens';
import { ChatHeader } from '@/components/chat/chat-header';
import { Effect } from 'effect';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';
import { useChatStore } from '@/store/chat-store-provider';
import { useState } from 'react';
import { MediaSheet } from '@/components/chat/media-sheet';
import { PinsSheet, type SheetPin } from '@/components/chat/pins-sheet';
import { runInBackground } from '@/lib/effect/run-in-background';
import { ChatPickerList } from '@/components/chat/chat-picker-list';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';

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

  const sheetUnpin = (pin: SheetPin) => {
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
