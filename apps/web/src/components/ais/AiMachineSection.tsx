import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { listMachines, setAiMachine, type PublicAi } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { FieldError } from './AiPageShell';
import { describeFailure, refetchAi } from './aiPanelOps';

/** T-0091: the AI's home machine. Lists the owner's approved machines plus
 *  "The platform"; a failed list leaves the select disabled on the current
 *  value only, so it can never silently change the AI's home. */
export function AiMachineSection({
  ai,
  setAi,
}: {
  ai: PublicAi;
  setAi: Dispatch<SetStateAction<PublicAi | null>>;
}) {
  // T-0091: the home machine dropdown lists the owner's approved machines.
  // A failure here must not block the rest of the panel: `machines` stays null
  // so the select can render its disabled "current value only" state.
  const [machineList] = useQuery(() => fromApi(() => listMachines()), []);
  const machines = AsyncResult.isSuccess(machineList) ? machineList.value : null;

  // The approved machines the dropdown may pick from; an unloaded list
  // means the select is disabled with the current value only.
  const approvedMachines = useMemo(
    () => (machines ?? []).filter((machine) => machine.status === 'approved'),
    [machines],
  );
  const machineOptionsLoaded = machines !== null;
  const currentMachineId = ai.machineId ?? null;
  // The current value always shows, even if the machine vanished or was
  // revoked in another tab — without it the dropdown would default to
  // "The platform", which would be a silent change.
  const knownMachineIds = new Set(approvedMachines.map((machine) => machine.id));
  const currentMachineIsKnown = currentMachineId === null || knownMachineIds.has(currentMachineId);

  const [machineError, setMachineError] = useState('');

  // T-0091: set or clear the home machine. The select carries the chosen
  // value already (`event.target.value`), so on a failure we have to roll
  // it back to the AI's previous value: the select itself is uncontrolled
  // and uses `ai.machineId` as the canonical source.
  // The select only carries approved machines plus "The platform", so a chosen id
  // is by construction known to the server. Still, the server is the source of
  // truth; on a 404 (a revoke that raced us) the panel reads the AI again instead
  // of crashing. A second change while one is in flight is dropped.
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
        // Roll back to the AI's previous value, then read the AI again so the panel
        // matches the server's view. The inline error stays visible either way.
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
    // A labelled select listing the owner's approved machines plus "The
    // platform (no machine)". When the machine list could not be loaded, or
    // the AI is on a machine since revoked in another tab, the select is
    // disabled and shows the current value only.
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
