import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect } from 'react';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { Avatar } from '../Avatar';
import { Button } from '../ui/button';

/** T-1783: how the Add key of an "isn't in this topic" row reads. */
export type TopicNotInState = 'idle' | 'busy' | 'failed';

/**
 * T-1783: the centred row a sender sees after mentioning someone who is not in
 * the open topic (docs/design/mockups/topic-people/Main.dc.html:55-59). The
 * Add key puts them in the topic; a failure shows a muted line in its place.
 */
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

/** The Add call of one row failed. */
class AddToTopicFailed extends Data.TaggedError('AddToTopicFailed') {}

/**
 * T-1783: one "isn't in this topic" row with its own Add call, so two rows can
 * be added while the sender keeps typing (the TopicActionButtons pattern).
 * `onAdded` drops the row once the person or AI is in.
 */
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
