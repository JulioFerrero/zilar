import { Effect } from 'effect';
import { MoreHorizontal } from 'lucide-react';
import type * as React from 'react';
import type { ApiFailure } from '@/lib/effect/errors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import type { GroupDetail, PublicAi } from '@/lib/api';
import { AiBadge } from '../AiBadge';
import { EntityAvatar } from '../EntityAvatar';
import { Button } from '../ui/button';
import { failInline } from './topic-failure';

type GroupMemberRow = GroupDetail['members'][number];

/**
 * The ⋯ key that opens a row's options menu (WebTopic.dc.html). It carries no
 * visible word, so the accessible name is the row's name plus "options".
 */
export function TopicOptionsKey({
  subject,
  ...props
}: { subject: string } & Omit<React.ComponentProps<'button'>, 'type' | 'aria-label'>) {
  return (
    <button
      type="button"
      aria-label={`${subject} options`}
      className="flex size-7 shrink-0 items-center justify-center rounded-lg text-subtle-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
      {...props}
    >
      <MoreHorizontal className="size-4" aria-hidden="true" />
    </button>
  );
}

/**
 * Removes one member from the topic. The row owns its call, so two rows can run
 * at once, and a second click on the same row is ignored while it waits.
 */
export function useRemoveMember({
  remove,
  onError,
}: {
  remove: (userId: string) => Effect.Effect<void, ApiFailure>;
  onError: (message: string) => void;
}): { removing: boolean; runRemove: (userId: string) => void } {
  const [state, run] = useAction<string, void, never>((userId) =>
    remove(userId).pipe(
      Effect.catchTag('ApiFailure', failInline(onError, 'Could not remove the member.')),
    ),
  );
  return {
    removing: isWaiting(state),
    runRemove: (userId) => {
      onError('');
      run(userId);
    },
  };
}

/** Adds one group member from the picker; one call per row, as useRemoveMember. */
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
      <EntityAvatar person={member} size={28} />
      <span className="min-w-0 flex-1 truncate">{member.name}</span>
      {adding && <span className="text-[12px] text-muted-foreground">Adding…</span>}
    </Button>
  );
}

/** Removes one AI from the topic, with its own call. */
export function useRemoveAi({
  remove,
  onError,
}: {
  remove: (aiId: string) => Effect.Effect<void, ApiFailure>;
  onError: (message: string) => void;
}): { removing: boolean; runRemove: (aiId: string) => void } {
  const [state, run] = useAction<string, void, never>((aiId) =>
    remove(aiId).pipe(
      Effect.catchTag('ApiFailure', failInline(onError, 'Could not remove the AI.')),
    ),
  );
  return {
    removing: isWaiting(state),
    runRemove: (aiId) => {
      onError('');
      run(aiId);
    },
  };
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
      <EntityAvatar person={{ id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }} size={28} ai />
      <span className="min-w-0 flex-1 truncate">{ai.name}</span>
      <AiBadge />
      {adding && <span className="text-[12px] text-muted-foreground">Adding…</span>}
    </Button>
  );
}
