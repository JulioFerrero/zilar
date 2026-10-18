import { Effect } from 'effect';
import { MoreHorizontal } from 'lucide-react';
import type * as React from 'react';
import type { ApiFailure } from '@zilar/client-core';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { failInline } from './topic-failure';

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
