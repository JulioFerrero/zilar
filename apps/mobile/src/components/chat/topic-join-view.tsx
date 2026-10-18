import { formatTime, senderColor } from '@zilar/chat-core';
import { PayloadSchema, isValid } from '@zilar/protocol';
import { useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { rawCall } from '@/components/chat/group-action';
import { PayloadCard } from '@/components/chat/payload-card';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { bubbleStyle } from '@/lib/depth';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { runInBackground } from '@/lib/effect/run-in-background';
import type { TopicPreviewMessage } from '@/lib/topics-api';
import type { ChatSummary } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';

const LOAD_ERROR = 'Could not load messages. Try again.';
const JOIN_ERROR = 'Could not join the topic. Try again.';

type PreviewState =
  { kind: 'loading' } | { kind: 'ready'; messages: TopicPreviewMessage[] } | { kind: 'error' };

/** `18:02` for a preview stamp; an unparsable stamp shows no time. */
function previewTime(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : formatTime(date);
}

/**
 * A public topic the caller has not joined (T-1798): its recent messages,
 * read-only, with one "Join {title}" key where the composer sits. The board is
 * `PhoneJoin.dc.html`. Joining runs the store action, whose answer repaints the
 * chat row, so the screen swaps this view for the normal thread.
 */
export function TopicJoinView({ chat }: { chat: ChatSummary }) {
  const joinTopic = useChatStore((state) => state.joinTopic);
  // The preview lives on the mock-aware topics port; the store action resolves
  // the topic id behind this chat row first.
  const topicPreview = useChatStore((state) => state.topicPreview);
  // The screen remounts this view with a `key` per topic, so this id is fixed
  // for the life of the mount. A result for anything else is ignored.
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
            // A preview row may carry the decoded `<agent>` payload with an
            // empty body. Like the web twin, only the display-only cards are
            // drawn here (no sender to check, no respond target); anything
            // else falls back to the row's text. A row with neither a drawable
            // card nor text has nothing to show and is skipped.
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
                  // Blocks and progress cards carry their own surface, like the
                  // thread: no bubble around them (T-1807, T-1814).
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
