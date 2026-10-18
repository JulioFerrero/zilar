import { useState, type Dispatch, type SetStateAction } from 'react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Cloud, Laptop, PowerOff, Sparkles, type LucideIcon } from 'lucide-react';
import type { AiComputerMode } from '@zilar/api-contract';
import { computerChoices, type ComputerMode } from '@zilar/chat-core';
import { getComputerOptions, updateAi, type PublicAi } from '@/lib/api';
import { fromApi } from '@zilar/client-core';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { FieldError, SelectOption } from './AiPageShell';
import { describeFailure, refetchAi } from './aiPanelOps';

const COMPUTER_ICONS: Record<ComputerMode, LucideIcon> = {
  off: PowerOff,
  cloud: Cloud,
  runner: Laptop,
  auto: Sparkles,
};

export function AiComputerSection({
  ai,
  setAi,
}: {
  ai: PublicAi;
  setAi: Dispatch<SetStateAction<PublicAi | null>>;
}) {
  // A pending or failed read reads as false, so the cloud option stays disabled
  // until the server confirms it.
  const [optionsResult] = useQuery(() => fromApi(() => getComputerOptions()), []);
  const cloud = AsyncResult.isSuccess(optionsResult) ? optionsResult.value.cloud : false;

  const currentMode = ai.computerMode ?? 'off';
  const hasMachine = (ai.machineId ?? null) !== null;

  const [computerError, setComputerError] = useState('');

  const [computerState, saveComputer] = useAction<AiComputerMode, void, never>((next) => {
    const previous = currentMode;
    if (next === previous) {
      return Effect.void;
    }
    const target = ai;
    const optimistic: PublicAi = { ...target, computerMode: next };
    return Effect.sync(() => {
      setAi(optimistic);
      setComputerError('');
    }).pipe(
      Effect.andThen(fromApi(() => updateAi(target.id, { computerMode: next }))),
      Effect.tap((fresh) => Effect.sync(() => setAi(fresh))),
      Effect.asVoid,
      Effect.catchTag('ApiFailure', (failure) =>
        Effect.sync(() => {
          setAi((current) => (current === null ? current : { ...current, computerMode: previous }));
          setComputerError(describeFailure(failure, 'Could not update the computer').message);
        }).pipe(Effect.andThen(refetchAi(target.id, setAi))),
      ),
    );
  });
  const busy = isWaiting(computerState);

  return (
    <section aria-label="Computer" className="flex flex-col gap-2">
      <h3 className="text-[14px] font-medium">Computer</h3>
      <div role="radiogroup" aria-label="Computer" className="flex flex-col gap-2">
        {computerChoices(cloud, hasMachine).map((choice) => {
          const Icon = COMPUTER_ICONS[choice.mode];
          const selected = choice.mode === currentMode;
          return (
            <SelectOption
              key={choice.mode}
              selected={selected}
              disabled={choice.disabled || busy}
              onClick={() => saveComputer(choice.mode)}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{choice.label}</span>
                <span className="block text-[13px] text-muted-foreground">
                  {choice.description}
                </span>
              </span>
            </SelectOption>
          );
        })}
      </div>
      {computerError !== '' && <FieldError>{computerError}</FieldError>}
    </section>
  );
}
