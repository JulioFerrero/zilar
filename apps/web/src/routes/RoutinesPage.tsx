import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Effect, Schedule } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Repeat } from 'lucide-react';
import { listMyRoutines, type MyRoutine } from '@/lib/tools';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { Card, SectionLabel } from '@/components/ui/card';
import { StateMessage } from '@/components/ui/state-message';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { RoutineRow } from '@/components/routines/RoutineRow';

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
