import { AiActivity } from './AiActivity';
import { AiDangerZone } from './AiDangerZone';
import { AiFormFields, AiLimitsFields } from './AiFormFields';
import { AiMemorySection } from './AiMemorySection';
import { FieldError, SelectOption } from './AiPageShell';
import {
  describeFailure,
  type PanelStatus,
  stripAvatarUrl,
  writeAi,
  refetchAi,
} from './aiPanelOps';
import { AiBadge } from '@/components/AiBadge';
import { AlwaysAllowedList } from '@/components/approvals/AlwaysAllowedList';
import { AvatarUploader } from '@/components/AvatarUploader';
import { EntityAvatar } from '@/components/EntityAvatar';
import { RoutinesSection } from '@/components/tools/RoutinesSection';
import { ToolsSection } from '@/components/tools/ToolsSection';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { StateMessage } from '@/components/ui/state-message';
import { Switch } from '@/components/ui/switch';
import {
  getAi,
  listAis,
  listConnections,
  updateAi,
  type Connection,
  type PublicAi,
  type UpdateAiInput,
  listMachines,
  setAiMachine,
  getComputerOptions,
} from '@/lib/api';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { cn } from '@/lib/utils';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import type { AiComputerMode } from '@zilar/api-contract';
import {
  type ChatSummary,
  formatUsd,
  computerChoices,
  type ComputerMode,
  buildPatch,
  defaultModelFor,
  modelSuggestionsFor,
  validateLimits,
} from '@zilar/chat-core';
import { fromApi, isWaiting } from '@zilar/client-core';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { X, Cloud, Laptop, PowerOff, Sparkles, type LucideIcon } from 'lucide-react';
import { useState, type Dispatch, type SetStateAction, useMemo } from 'react';

function UsageMeter({ label, text, fraction }: { label: string; text: string; fraction: number }) {
  const clamped = Math.min(1, Math.max(0, fraction));
  const over = fraction >= 1;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[13px] text-muted-foreground">{text}</p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
        className="well-surface h-1 overflow-hidden rounded-full"
      >
        <div
          className={cn('h-full rounded-full', over && 'bg-danger')}
          style={{
            width: `${Math.round(clamped * 100)}%`,
            ...(over ? {} : { backgroundColor: '#ededed' }),
          }}
        />
      </div>
    </div>
  );
}

function UsageBlock({ ai }: { ai: PublicAi }) {
  const usage = ai.usage ?? null;
  const perDayUsd = ai.limits.perDayUsd;
  const perMonthUsd = ai.limits.perMonthUsd;
  return (
    <section aria-label="Usage" className="flex flex-col gap-2">
      <h3 className="text-[14px] font-medium">Usage</h3>
      {usage === null ? (
        <p className="text-[13px] text-muted-foreground">Usage unavailable</p>
      ) : (
        <>
          {perDayUsd === null ? (
            <p className="text-[13px] text-muted-foreground">Today {formatUsd(usage.todayUsd)}</p>
          ) : (
            <UsageMeter
              label="Today's spend"
              text={`Today ${formatUsd(usage.todayUsd)} of ${formatUsd(perDayUsd)}`}
              fraction={perDayUsd > 0 ? usage.todayUsd / perDayUsd : 1}
            />
          )}
          {perMonthUsd === null ? (
            <p className="text-[13px] text-muted-foreground">
              30 days {formatUsd(usage.windowUsd)}
            </p>
          ) : (
            <UsageMeter
              label="30-day window spend"
              text={`30 days ${formatUsd(usage.windowUsd)} of ${formatUsd(perMonthUsd)}`}
              fraction={perMonthUsd > 0 ? usage.windowUsd / perMonthUsd : 1}
            />
          )}
        </>
      )}
      <p className="text-[13px] text-muted-foreground">Spend updates after each reply.</p>
    </section>
  );
}

function AiPictureSection({ ai, onChanged }: { ai: PublicAi; onChanged: (ai: PublicAi) => void }) {
  return (
    <AvatarUploader
      kind="ai"
      ownerId={ai.id}
      ownerName={ai.name}
      currentUrl={ai.avatarUrl}
      onChanged={(url) =>
        onChanged(url === undefined ? stripAvatarUrl(ai) : { ...ai, avatarUrl: url })
      }
    />
  );
}

export { UsageBlock };

function AiDelegationSection({
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

function AiMachineSection({
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

const COMPUTER_ICONS: Record<ComputerMode, LucideIcon> = {
  off: PowerOff,
  cloud: Cloud,
  runner: Laptop,
  auto: Sparkles,
};

function AiComputerSection({
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

export function AiPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const storeApi = useChatStoreApi();

  const [status, setStatus] = useState<PanelStatus>('loading');
  const [ai, setAi] = useState<PublicAi | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [name, setName] = useState('');
  const [persona, setPersona] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  const seedForm = (next: PublicAi): void => {
    setAi(next);
    setName(next.name);
    setPersona(next.persona);
    setDay(next.limits.perDayUsd === null ? '' : String(next.limits.perDayUsd));
    setMonth(next.limits.perMonthUsd === null ? '' : String(next.limits.perMonthUsd));
    setSelectedConnectionId(next.providerConnectionId);
    setModelDraft(next.model);
  };

  useQuery(
    () =>
      fromApi(() => listAis()).pipe(
        Effect.map((list) => list.find((item) => item.jid === chat.id) ?? null),
        Effect.tap((found) =>
          Effect.sync(() => {
            if (found === null) {
              setStatus('missing');
              return;
            }
            seedForm(found);
            setStatus('ready');
          }),
        ),
        Effect.tapError((failure) =>
          Effect.sync(() => {
            setErrorMessage(describeFailure(failure, 'Could not load the AI').message);
            setStatus('error');
          }),
        ),
      ),
    [chat.id],
  );

  const [connectionList] = useQuery(() => fromApi(() => listConnections()), []);
  const connections: Connection[] = AsyncResult.isSuccess(connectionList)
    ? connectionList.value.filter((connection) => connection.status === 'active')
    : [];

  const usableConnections = connections;
  const effectiveConnection =
    selectedConnectionId === null
      ? null
      : (usableConnections.find((connection) => connection.id === selectedConnectionId) ?? null);

  const limits = validateLimits(day, month);
  const basePatch =
    ai === null
      ? null
      : buildPatch({
          name,
          originalName: ai.name,
          persona,
          originalPersona: ai.persona,
          limits: limits.limits,
          originalLimits: ai.limits,
        });
  // A connection change always carries the model too: the server needs the model
  // whenever the connection changes.
  const modelTrimmed = modelDraft.trim();
  const modelChanged = ai !== null && modelTrimmed !== '' && modelTrimmed !== ai.model;
  const connectionChanged =
    ai !== null &&
    selectedConnectionId !== null &&
    selectedConnectionId !== ai.providerConnectionId;
  let patch: UpdateAiInput | null = basePatch;
  if (connectionChanged || modelChanged) {
    patch = {
      ...patch,
      model: modelTrimmed,
      ...(connectionChanged && selectedConnectionId !== null
        ? { providerConnectionId: selectedConnectionId }
        : {}),
    };
  }
  const switchingModel = patch !== null && ('model' in patch || 'providerConnectionId' in patch);
  const savable =
    ai !== null &&
    name.trim() !== '' &&
    modelTrimmed !== '' &&
    limits.limits !== null &&
    patch !== null;

  const markEdited = (): void => {
    setSaved(false);
    setSaveError('');
  };

  const chooseConnection = (id: string): void => {
    setSelectedConnectionId(id);
    const next = usableConnections.find((connection) => connection.id === id) ?? null;
    if (next !== null) {
      setModelDraft(defaultModelFor(next.provider));
    }
    markEdited();
  };

  // A combined PATCH can commit one field and fail a later one, so a failure
  // reads the AI again; if that read fails the form falls back to the values the
  // save started from.
  const [saveState, runSave] = useAction<void, void, never>(() => {
    if (ai === null || patch === null || !savable) {
      return Effect.void;
    }
    const target = ai;
    const changes = patch;
    return Effect.sync(() => setSaveError('')).pipe(
      Effect.andThen(fromApi(() => updateAi(target.id, changes))),
      Effect.tap((updated) =>
        Effect.sync(() => {
          seedForm(updated);
          setSaved(true);
          storeApi.setState((state) => ({
            chats: state.chats.map((chatItem) =>
              chatItem.id === chat.id ? { ...chatItem, title: updated.name } : chatItem,
            ),
          }));
        }),
      ),
      Effect.catchTag('ApiFailure', (failure) =>
        Effect.sync(() =>
          setSaveError(describeFailure(failure, 'Could not update the AI').message),
        ).pipe(
          Effect.andThen(
            fromApi(() => getAi(target.id)).pipe(
              Effect.tap((fresh) => Effect.sync(() => seedForm(fresh))),
              Effect.catchTag('ApiFailure', () =>
                Effect.sync(() => {
                  setSelectedConnectionId(target.providerConnectionId);
                  setModelDraft(target.model);
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });
  const busy = isWaiting(saveState);
  const canSave = savable && !busy;

  return (
    <>
      <Sheet open onClose={onClose} ariaLabel={`${chat.title} AI settings`}>
        <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
          <EntityAvatar
            person={
              ai === null ? undefined : { id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }
            }
            chat={ai === null ? chat : undefined}
            size={44}
            ai
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[16px] font-semibold">{ai?.name ?? chat.title}</span>
              <AiBadge />
              {ai !== null && ai.status === 'stopped' && (
                <span className="rounded-full border border-divider px-2 py-0.5 text-[12px] font-medium text-muted-foreground">
                  Stopped
                </span>
              )}
            </div>
            <p className="text-[13px] text-muted-foreground">AI settings</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label="Close AI panel"
            onClick={onClose}
            className="shrink-0 rounded-full text-muted-foreground"
          >
            <X className="size-5" aria-hidden="true" />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {status === 'loading' && <StateMessage kind="loading" size="inline" title="Loading…" />}

          {status === 'missing' && (
            <p className="text-[15px] text-muted-foreground">This AI no longer exists.</p>
          )}

          {status === 'error' && (
            <p role="alert" className="text-[15px] text-danger">
              {errorMessage}
            </p>
          )}

          {status === 'ready' && ai !== null && (
            <>
              <AiFormFields
                name={name}
                persona={persona}
                connections={usableConnections}
                selectedConnectionId={selectedConnectionId}
                modelProvider={effectiveConnection?.provider ?? ''}
                modelSuggestions={
                  effectiveConnection === null
                    ? []
                    : modelSuggestionsFor(effectiveConnection.provider)
                }
                modelDraft={modelDraft}
                onNameChange={(value) => {
                  setName(value);
                  markEdited();
                }}
                onPersonaChange={(value) => {
                  setPersona(value);
                  markEdited();
                }}
                onChooseConnection={chooseConnection}
                onModelChange={(next) => {
                  setModelDraft(next);
                  markEdited();
                }}
              />

              <AiMachineSection ai={ai} setAi={setAi} />

              <AiComputerSection ai={ai} setAi={setAi} />

              <UsageBlock ai={ai} />

              <AiDelegationSection ai={ai} setAi={setAi} />

              <AiMemorySection chat={chat.id} aiId={ai.id} aiName={ai.name} />

              <AiPictureSection ai={ai} onChanged={setAi} />

              <AiLimitsFields
                day={day}
                month={month}
                dayError={limits.dayError}
                monthError={limits.monthError}
                onDayChange={(value) => {
                  setDay(value);
                  markEdited();
                }}
                onMonthChange={(value) => {
                  setMonth(value);
                  markEdited();
                }}
              />

              {saveError !== '' && <FieldError>{saveError}</FieldError>}
              {saved && (
                <p role="status" className="text-[13px] text-online">
                  Saved
                </p>
              )}

              <AiDangerZone ai={ai} setAi={setAi} chat={chat} onClose={onClose} />

              <AiActivity aiId={ai.id} />

              <AlwaysAllowedList scope={{ aiId: ai.id }} />

              <ToolsSection scope={{ aiId: ai.id }} scopeKey={`ai:${ai.id}`} canManage />
              <RoutinesSection
                scope={{ aiId: ai.id }}
                scopeKey={`ai-routines:${ai.id}`}
                canManage
              />
            </>
          )}
        </div>

        {status === 'ready' && ai !== null && (
          <footer className="shrink-0 border-t border-divider p-4">
            <Button
              type="button"
              size="lg"
              className="rounded-full px-5"
              disabled={!canSave}
              onClick={() => runSave()}
            >
              {busy ? (switchingModel ? 'Switching model…' : 'Saving…') : 'Save'}
            </Button>
          </footer>
        )}
      </Sheet>
    </>
  );
}
