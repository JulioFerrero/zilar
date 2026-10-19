import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Effect, Schedule } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Check, MessageCircle, Pause, Play, Repeat, Trash2, X } from 'lucide-react';
import { deleteRoutine, listMyRoutines, pauseRoutine, resumeRoutine } from '@/lib/tools';
import { describeRoutineSchedule } from '@zilar/chat-core';
import { fromApi, type ApiFailure, failureOf, isWaiting } from '@zilar/client-core';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { EntityAvatar } from '@/components/EntityAvatar';
import { Card, SectionLabel } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { cn } from '@/lib/utils';
import type { MyRoutine } from '@zilar/api-contract';

const REFRESH_INTERVAL_MS = 30_000;

export function RoutinesPage() {
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');
  const [list, refresh] = useQuery(() => fromApi(() => listMyRoutines()), []);

  useQuery(
    () =>
      Effect.sync(() => refresh()).pipe(
        Effect.repeat(Schedule.spaced(REFRESH_INTERVAL_MS)),
        Effect.delay(REFRESH_INTERVAL_MS),
      ),
    [],
  );

  const listFailure = isWaiting(list) ? undefined : failureOf(list);
  const routines = AsyncResult.isSuccess(list) ? list.value : [];
  const running = routines.filter((routine) => routine.status === 'active');
  const paused = routines.filter((routine) => routine.status !== 'active');

  const changed = (): void => {
    setNotice('');
    refresh();
  };

  return (
    <SettingsShell title="Routines" onBack={() => navigate('/settings')}>
      <div className={SETTINGS_COLUMN}>
        {AsyncResult.isSuccess(list) && routines.length === 0 && (
          <StateMessage kind="empty" icon={Repeat} title="No routines yet" />
        )}

        {AsyncResult.isSuccess(list) && routines.length > 0 && (
          <>
            {running.length > 0 && (
              <RoutineGroup
                label="Running"
                routines={running}
                onChanged={changed}
                onFailed={setNotice}
              />
            )}
            {paused.length > 0 && (
              <RoutineGroup
                label="Paused"
                routines={paused}
                onChanged={changed}
                onFailed={setNotice}
              />
            )}
          </>
        )}

        {notice !== '' && (
          <p role="status" className="text-[14px] text-muted-foreground">
            {notice}
          </p>
        )}

        {listFailure === undefined && !AsyncResult.isSuccess(list) && (
          <StateMessage kind="loading" title="Loading routines…" />
        )}

        {listFailure !== undefined && (
          <StateMessage
            kind="error"
            title={listMessage(listFailure)}
            action={{ label: 'Retry', onClick: () => refresh() }}
          />
        )}
      </div>
    </SettingsShell>
  );
}

function RoutineGroup({
  label,
  routines,
  onChanged,
  onFailed,
}: {
  label: string;
  routines: MyRoutine[];
  onChanged: () => void;
  onFailed: (message: string) => void;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <SectionLabel>{label}</SectionLabel>
      <Card>
        {routines.map((routine) => (
          <RoutineRow
            key={routine.id}
            routine={routine}
            onChanged={onChanged}
            onFailed={onFailed}
          />
        ))}
      </Card>
    </section>
  );
}

function listMessage(failure: ApiFailure): string {
  return failure.code === 'unknown_error' ? 'Could not load your routines.' : failure.message;
}

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

/**
 * A fixed sentence for a failed action; the API message never reaches the row.
 */
function failureText(failure: ApiFailure): string {
  if (failure.status === 403 || failure.status === 404) {
    return 'You may not change this routine.';
  }
  if (failure.code === 'needs_approval') {
    return 'This routine needs re-approval. Ask the AI to schedule it again.';
  }
  return 'Could not update the routine.';
}

function RoutineRow({
  routine,
  onChanged,
  onFailed,
}: {
  routine: MyRoutine;
  onChanged: () => void;
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
