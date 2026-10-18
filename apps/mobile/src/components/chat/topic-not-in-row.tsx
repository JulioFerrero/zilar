import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect } from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/chat/avatar';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';

export interface TopicNotIn {
  jid: string;
  name: string;
  kind: 'person' | 'ai';
  id: string;
  avatarUrl?: string | undefined;
}

export type TopicNotInState = 'idle' | 'busy' | 'failed';

// The centred row a sender sees after mentioning someone who is not in the open topic: the Add key puts them in; a failure shows a muted line in its place.
export function TopicNotInRow({
  name,
  avatarUrl,
  topicTitle,
  state,
  onAdd,
}: {
  name: string;
  avatarUrl?: string | undefined;
  topicTitle: string;
  state: TopicNotInState;
  onAdd: () => void;
}) {
  return (
    <View className="flex-row items-center gap-2.5 rounded-[14px] border border-[#232323] bg-[#141414] py-1.5 pr-1.5 pl-3">
      <Avatar
        seed={name}
        name={name}
        size={22}
        {...(avatarUrl === undefined ? {} : { avatarUrl })}
      />
      <Text className="text-[15px] text-[#a1a1a1]">{`${name} isn't in ${topicTitle}`}</Text>
      {state === 'failed' ? (
        <Text className="pr-1.5 text-[13px] text-muted-foreground">Couldn&apos;t add</Text>
      ) : (
        <Button
          className="rounded-[12px]"
          disabled={state === 'busy'}
          accessibilityLabel={`Add ${name} to ${topicTitle}`}
          onPress={onAdd}
        >
          <Text>{state === 'busy' ? 'Adding…' : 'Add'}</Text>
        </Button>
      )}
    </View>
  );
}

class AddToTopicFailed extends Data.TaggedError('AddToTopicFailed') {}

// One row with its own Add call, so two rows can be added while the sender keeps typing; `onAdded` drops the row once the person or AI is in.
export function AddToTopicRow({
  name,
  avatarUrl,
  topicTitle,
  add,
  onAdded,
}: {
  name: string;
  avatarUrl?: string | undefined;
  topicTitle: string;
  add: () => Promise<void>;
  onAdded: () => void;
}) {
  const [state, run] = useAction<void, void, AddToTopicFailed>(() =>
    Effect.tryPromise({ try: add, catch: () => new AddToTopicFailed() }),
  );
  const done = AsyncResult.isSuccess(state);
  useEffect(() => {
    if (done) {
      onAdded();
    }
  }, [done, onAdded]);
  return (
    <TopicNotInRow
      name={name}
      avatarUrl={avatarUrl}
      topicTitle={topicTitle}
      state={isWaiting(state) ? 'busy' : failureOf(state) === undefined ? 'idle' : 'failed'}
      onAdd={() => run()}
    />
  );
}
