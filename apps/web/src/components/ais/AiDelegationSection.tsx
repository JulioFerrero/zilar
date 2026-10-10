import { useState, type Dispatch, type SetStateAction } from 'react';
import { updateAi, type PublicAi, type UpdateAiInput } from '@/lib/api';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { Switch } from '@/components/ui/switch';
import { FieldError } from './AiPageShell';
import { writeAi } from './aiPanelOps';

/** T-0478: the owner's delegation opt-ins. Each switch saves on its own
 *  through `updateAi`, separate from the main form's Save. On failure the
 *  inline error shows and the switch keeps its old value (never optimistic). */
export function AiDelegationSection({
  ai,
  setAi,
}: {
  ai: PublicAi;
  setAi: Dispatch<SetStateAction<PublicAi | null>>;
}) {
  const [delegationError, setDelegationError] = useState('');

  const [delegationState, saveDelegation] = useAction<UpdateAiInput, void, never>((input) => {
    const target = ai;
    return writeAi({
      clearError: () => setDelegationError(''),
      setError: setDelegationError,
      failedText: 'Could not update the AI',
      call: () => updateAi(target.id, input),
      onSuccess: (updated) => setAi(updated),
    });
  });
  const delegationBusy = isWaiting(delegationState);

  return (
    <section aria-label="Delegation" className="flex flex-col gap-2">
      <h3 className="text-[14px] font-medium">Delegation</h3>
      <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-list-hover">
        <span className="flex flex-col">
          <span className="text-[14px]">Can delegate</span>
          <span className="text-[13px] text-muted-foreground">
            Hand tasks to other AIs in a group
          </span>
        </span>
        <Switch
          checked={ai.canDelegate === true}
          onCheckedChange={(checked) => saveDelegation({ canDelegate: checked })}
          label="Can delegate"
          hideLabel
          disabled={delegationBusy}
        />
      </label>
      <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-list-hover">
        <span className="flex flex-col">
          <span className="text-[14px]">Accepts tasks</span>
          <span className="text-[13px] text-muted-foreground">
            Other AIs in a group can hand this AI tasks. It works on them with its own model and
            budget
          </span>
        </span>
        <Switch
          checked={ai.acceptsDelegation === true}
          onCheckedChange={(checked) => saveDelegation({ acceptsDelegation: checked })}
          label="Accepts tasks"
          hideLabel
          disabled={delegationBusy}
        />
      </label>
      {delegationError !== '' && <FieldError>{delegationError}</FieldError>}
    </section>
  );
}
