import { Effect } from 'effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import type { GroupDetail, PublicAi, TopicAi, TopicMember } from '@/lib/api';
import { AiBadge } from '../AiBadge';
import { Avatar } from '../Avatar';
import { Button } from '../ui/button';
import { failInline } from './topic-failure';

type GroupMemberRow = GroupDetail['members'][number];

/**
 * Removes one member. The row owns its call, so two rows can run at once, and
 * a second click on the same row is ignored while it waits.
 */
export function RemoveMemberButton({
  member,
  remove,
  onError,
}: {
  member: TopicMember;
  remove: (userId: string) => Effect.Effect<void, ApiFailure>;
  onError: (message: string) => void;
}) {
  const [state, run] = useAction<string, void, never>((userId) =>
    remove(userId).pipe(
      Effect.catchTag('ApiFailure', failInline(onError, 'Could not remove the member.')),
    ),
  );
  const removing = isWaiting(state);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Remove ${member.name} from the topic`}
      className="shrink-0"
      disabled={removing}
      onClick={() => {
        onError('');
        run(member.userId);
      }}
    >
      {removing ? 'Removing…' : 'Remove'}
    </Button>
  );
}

/** Adds one group member from the picker; one call per row, as RemoveMemberButton. */
export function AddMemberButton({
  member,
  add,
  onError,
}: {
  member: GroupMemberRow;
  add: (userId: string) => Effect.Effect<void, ApiFailure>;
  onError: (message: string) => void;
}) {
  const [state, run] = useAction<string, void, never>((userId) =>
    add(userId).pipe(
      Effect.catchTag('ApiFailure', failInline(onError, 'Could not add the member.')),
    ),
  );
  const adding = isWaiting(state);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={adding}
      onClick={() => {
        onError('');
        run(member.userId);
      }}
      className="h-auto justify-start gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] font-normal"
    >
      <Avatar id={member.userId} name={member.name} size={28} avatarUrl={member.avatarUrl} />
      <span className="min-w-0 flex-1 truncate">{member.name}</span>
      {adding && <span className="text-[12px] text-muted-foreground">Adding…</span>}
    </Button>
  );
}

/** Removes one AI from the topic, with its own call. */
export function RemoveAiButton({
  ai,
  remove,
  onError,
}: {
  ai: TopicAi;
  remove: (aiId: string) => Effect.Effect<void, ApiFailure>;
  onError: (message: string) => void;
}) {
  const [state, run] = useAction<string, void, never>((aiId) =>
    remove(aiId).pipe(
      Effect.catchTag('ApiFailure', failInline(onError, 'Could not remove the AI.')),
    ),
  );
  const removing = isWaiting(state);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Remove ${ai.name} from the topic`}
      className="shrink-0"
      disabled={removing}
      onClick={() => {
        onError('');
        run(ai.id);
      }}
    >
      {removing ? 'Removing…' : 'Remove'}
    </Button>
  );
}

/** Adds one of my AIs from the picker, with its own call. */
export function AddAiButton({
  ai,
  add,
  onError,
}: {
  ai: PublicAi;
  add: (aiId: string) => Effect.Effect<void, ApiFailure>;
  onError: (message: string) => void;
}) {
  const [state, run] = useAction<string, void, never>((aiId) =>
    add(aiId).pipe(Effect.catchTag('ApiFailure', failInline(onError, 'Could not add the AI.'))),
  );
  const adding = isWaiting(state);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={adding}
      onClick={() => {
        onError('');
        run(ai.id);
      }}
      className="h-auto justify-start gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] font-normal"
    >
      <Avatar id={ai.jid} name={ai.name} size={28} ai avatarUrl={ai.avatarUrl} />
      <span className="min-w-0 flex-1 truncate">{ai.name}</span>
      <AiBadge />
      {adding && <span className="text-[12px] text-muted-foreground">Adding…</span>}
    </Button>
  );
}
