import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, MessageCircle, Pause, Play, Trash2, X } from 'lucide-react';
import { Effect } from 'effect';
import { deleteRoutine, pauseRoutine, resumeRoutine, type MyRoutine } from '@/lib/tools';
import { describeRoutineSchedule } from '@/lib/routines';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { EntityAvatar } from '@/components/EntityAvatar';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

type RoutineWork = 'pause' | 'resume' | 'delete';

function workCall(work: RoutineWork, id: string): Promise<unknown> {
  if (work === 'pause') {
    return pauseRoutine(id);
  }
  if (work === 'resume') {
    return resumeRoutine(id);
  }
  return deleteRoutine(id);
}

/** A fixed sentence for a failed action; the API message never reaches the row. */
function failureText(failure: ApiFailure): string {
  if (failure.status === 403 || failure.status === 404) {
    return 'You may not change this routine.';
  }
  if (failure.code === 'needs_approval') {
    return 'This routine needs re-approval. Ask the AI to schedule it again.';
  }
  return 'Could not update the routine.';
}

/**
 * One routine in Settings › Routines: the AI's ball, the title with a status
 * dot, the schedule · AI · chat line, an Ask key that opens the chat, and a
 * Pause or Resume key. Clicking the row reveals a red Delete key; deleting
 * takes the same two-step confirm the tools panel uses.
 */
export function RoutineRow({
  routine,
  onChanged,
  onFailed,
}: {
  routine: MyRoutine;
  /** Refetch the list after a change; the server owns the new order. */
  onChanged: () => void;
  /** A fixed sentence when an action fails, shown by the page. */
  onFailed: (message: string) => void;
}) {
  const navigate = useNavigate();
  const [revealed, setRevealed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [state, perform] = useAction((work: RoutineWork) =>
    fromApi(() => workCall(work, routine.id)).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          setConfirming(false);
          setRevealed(false);
          onChanged();
        }),
      ),
      Effect.tapError((failure) => Effect.sync(() => onFailed(failureText(failure)))),
    ),
  );
  const busy = isWaiting(state);
  const running = routine.status === 'active';
  const chatJid = routine.chatJid;

  const toggleRow = (): void => {
    setConfirming(false);
    setRevealed((open) => !open);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <button
        type="button"
        onClick={toggleRow}
        aria-expanded={revealed}
        aria-label={`${routine.title}, ${running ? 'running' : 'paused'}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <EntityAvatar
          person={{
            id: routine.aiId ?? routine.id,
            name: routine.aiName,
            avatarUrl: routine.aiAvatarUrl,
          }}
          size={32}
          ai
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span
              role="img"
              aria-label={running ? 'Running' : 'Paused'}
              className={cn(
                'size-2 shrink-0 rounded-full',
                running ? 'bg-online' : 'bg-muted-foreground',
              )}
            />
            <span className="truncate text-[15px] font-medium text-foreground">
              {routine.title}
            </span>
          </span>
          <span className="truncate text-[13px] text-muted-foreground">
            <span className="font-mono">{describeRoutineSchedule(routine.schedule)}</span>
            {' · '}
            {routine.aiName}
            {routine.chatName === null ? '' : ` · ${routine.chatName}`}
          </span>
        </span>
      </button>

      {chatJid !== null && (
        <IconButton
          aria-label={`Ask ${routine.aiName} about ${routine.title}`}
          disabled={busy}
          onClick={() => navigate(`/c/${encodeURIComponent(chatJid)}`)}
        >
          <MessageCircle className="size-4" aria-hidden="true" />
        </IconButton>
      )}

      <IconButton
        aria-label={`${running ? 'Pause' : 'Resume'} ${routine.title}`}
        disabled={busy}
        onClick={() => perform(running ? 'pause' : 'resume')}
      >
        {running ? (
          <Pause className="size-4" aria-hidden="true" />
        ) : (
          <Play className="size-4" aria-hidden="true" />
        )}
      </IconButton>

      {revealed && !confirming && (
        <IconButton
          aria-label={`Delete ${routine.title}`}
          className="text-danger"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </IconButton>
      )}

      {confirming && (
        <>
          <IconButton
            aria-label={`Confirm deleting ${routine.title}`}
            className="text-danger"
            disabled={busy}
            onClick={() => perform('delete')}
          >
            <Check className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton
            aria-label={`Cancel deleting ${routine.title}`}
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </>
      )}
    </div>
  );
}
