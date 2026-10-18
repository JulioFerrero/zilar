import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect } from 'react';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { Avatar } from '../Avatar';
import { Button } from '../ui/button';

export type TopicNotInState = 'idle' | 'busy' | 'failed';

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
    <div
      role="status"
      className="flex items-center gap-2.5 rounded-[14px] border border-[#232323] bg-[#141414] py-1.5 pr-1.5 pl-3"
    >
      <Avatar seed={name} name={name} size={22} avatarUrl={avatarUrl} />
      <span className="text-[14px] text-[#a1a1a1]">
        {name} isn&apos;t in {topicTitle}
      </span>
      {state === 'failed' ? (
        <span className="pr-1.5 text-[13px] text-muted-foreground">Couldn&apos;t add</span>
      ) : (
        <Button size="sm" disabled={state === 'busy'} onClick={onAdd}>
          {state === 'busy' ? 'Adding…' : 'Add'}
        </Button>
      )}
    </div>
  );
}

class AddToTopicFailed extends Data.TaggedError('AddToTopicFailed') {}

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
