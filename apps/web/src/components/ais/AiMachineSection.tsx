import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { listMachines, setAiMachine, type PublicAi } from '@/lib/api';
import { fromApi } from '@zilar/client-core';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { FieldError } from './AiPageShell';
import { describeFailure, refetchAi } from './aiPanelOps';

export function AiMachineSection({
  ai,
  setAi,
}: {
  ai: PublicAi;
  setAi: Dispatch<SetStateAction<PublicAi | null>>;
}) {
  const [machineList] = useQuery(() => fromApi(() => listMachines()), []);
  const machines = AsyncResult.isSuccess(machineList) ? machineList.value : null;

  const approvedMachines = useMemo(
    () => (machines ?? []).filter((machine) => machine.status === 'approved'),
    [machines],
  );
  const machineOptionsLoaded = machines !== null;
  const currentMachineId = ai.machineId ?? null;
  // The current value always shows, even if the machine vanished or was revoked
  // in another tab: without it the select would silently reset to "The platform".
  const knownMachineIds = new Set(approvedMachines.map((machine) => machine.id));
  const currentMachineIsKnown = currentMachineId === null || knownMachineIds.has(currentMachineId);

  const [machineError, setMachineError] = useState('');

  // The select is uncontrolled and `ai.machineId` is the source of truth: roll
  // the chosen value back on failure and read the AI again on a 404 (a revoke
  // that raced us). A second change while one is in flight is dropped.
  const [machineState, runMachine] = useAction<string, void, never>((nextValue) => {
    const previous = ai.machineId ?? null;
    const next = nextValue === '' ? null : nextValue;
    if (next === previous) {
      return Effect.void;
    }
    const target = ai;
    const optimistic: PublicAi = { ...target, machineId: next };
    return Effect.sync(() => {
      setAi(optimistic);
      setMachineError('');
    }).pipe(
      Effect.andThen(fromApi(() => setAiMachine(target.id, next))),
      Effect.tap((fresh) => Effect.sync(() => setAi(fresh))),
      Effect.asVoid,
      Effect.catchTag('ApiFailure', (failure) =>
        Effect.sync(() => {
          setAi((current) => (current === null ? current : { ...current, machineId: previous }));
          setMachineError(describeFailure(failure, 'Could not update the home machine').message);
        }).pipe(Effect.andThen(refetchAi(target.id, setAi))),
      ),
    );
  });
  const machineBusy = isWaiting(machineState);
  const machineSelectDisabled = !machineOptionsLoaded || machineBusy;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="ai-panel-machine" className="text-[14px] font-medium">
        Runs on
      </label>
      <select
        id="ai-panel-machine"
        aria-label="Runs on"
        value={currentMachineId ?? ''}
        disabled={machineSelectDisabled}
        onChange={(event) => runMachine(event.target.value)}
        className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
      >
        {machineOptionsLoaded && <option value="">The platform (no machine)</option>}
        {approvedMachines.map((machine) => (
          <option key={machine.id} value={machine.id}>
            {machine.name}
          </option>
        ))}
        {!currentMachineIsKnown && currentMachineId !== null && (
          <option value={currentMachineId}>Current machine (unavailable)</option>
        )}
      </select>
      {machineError !== '' && <FieldError>{machineError}</FieldError>}
    </div>
  );
}
