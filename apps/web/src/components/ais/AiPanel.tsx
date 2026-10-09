import { useMemo, useState } from 'react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useNavigate } from 'react-router';
import type { ChatSummary } from '@zilar/chat-core';
import { X } from 'lucide-react';
import {
  ApiError,
  deleteAi,
  getAi,
  listAis,
  listConnections,
  listMachines,
  resumeAi,
  setAiMachine,
  stopAi,
  updateAi,
  type Connection,
  type PublicAi,
  type UpdateAiInput,
} from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { AiBadge } from '@/components/AiBadge';
import { Avatar } from '@/components/Avatar';
import { AvatarUploader } from '@/components/AvatarUploader';
import { Sheet } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { TextArea, TextInput } from '@/components/ui/text-input';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';
import { StateMessage } from '@/components/ui/state-message';
import { Button } from '@/components/ui/button';
import { FieldError } from './AiPageShell';
import { AiActivity } from './AiActivity';
import { AiMemorySection } from './AiMemorySection';
import { AlwaysAllowedList } from '@/components/approvals/AlwaysAllowedList';
import { RoutinesSection } from '@/components/tools/RoutinesSection';
import { ToolsSection } from '@/components/tools/ToolsSection';
import { ConnectionPicker } from './ConnectionPicker';
import { describeAiError, type AiErrorInfo } from './errors';
import { LimitsFields } from './LimitsFields';
import { validateLimits } from './limits';
import { ModelPicker } from './ModelPicker';
import { defaultModelFor, modelSuggestionsFor } from './models';
import { buildPatch } from './aiForm';

type PanelStatus = 'loading' | 'ready' | 'missing' | 'error';

// An api.ts failure keeps its server answer: it is rebuilt as the ApiError that
// describeAiError reads. A failure with no status did not come from the server,
// so it shows the fixed fallback sentence instead of the thrown text.
function describeFailure(failure: ApiFailure, fallback: string): AiErrorInfo {
  if (failure.status === 0) {
    return { message: fallback, unavailable: false };
  }
  return describeAiError(
    new ApiError(failure.status, failure.code, failure.message, failure.detail),
    fallback,
  );
}

// Reads the AI again after a failed write. The read is best-effort: the inline
// error stays visible whether or not it works, so its own failure is dropped.
const refetchAi = (id: string, apply: (next: PublicAi) => void) =>
  fromApi(() => getAi(id)).pipe(
    Effect.tap((fresh) => Effect.sync(() => apply(fresh))),
    Effect.catchTag('ApiFailure', () => Effect.void),
  );

/** The AI's picture (T-0165), for the AI's owner. Refreshes the panel row
 *  from the uploader's answer so the header shows the new picture at once. */
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

function stripAvatarUrl(ai: PublicAi): PublicAi {
  const { avatarUrl: _removed, ...rest } = ai;
  void _removed;
  return rest;
}

/** `$2` -> `$2.00`. Server amounts are plain USD numbers. */
function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * One thin spend meter: a well track with a `#ededed` fill, turning
 * `--danger` at or above 100% (ui-style.md §4).
 */
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

/**
 * The AI's spend (T-0058): today's spend against the daily cap and the key's
 * current spend against the monthly cap. LiteLLM tracks spend in batches, so
 * the numbers lag a turn or two — the help text says so.
 */
export function UsageBlock({ ai }: { ai: PublicAi }) {
  const usage = ai.usage ?? null;
  return (
    <section aria-label="Usage" className="flex flex-col gap-2">
      <h3 className="text-[14px] font-medium">Usage</h3>
      {usage === null ? (
        <p className="text-[13px] text-muted-foreground">Usage unavailable</p>
      ) : (
        <>
          <UsageMeter
            label="Today's spend"
            text={`Today ${formatUsd(usage.todayUsd)} of ${formatUsd(ai.limits.perDayUsd)}`}
            fraction={ai.limits.perDayUsd > 0 ? usage.todayUsd / ai.limits.perDayUsd : 1}
          />
          <UsageMeter
            label="30-day window spend"
            text={`30-day window ${formatUsd(usage.windowUsd)} of ${formatUsd(ai.limits.perMonthUsd)}`}
            fraction={ai.limits.perMonthUsd > 0 ? usage.windowUsd / ai.limits.perMonthUsd : 1}
          />
        </>
      )}
      <p className="text-[13px] text-muted-foreground">
        Spend updates within a minute or two; the daily limit may let a last reply through.
      </p>
    </section>
  );
}

/**
 * The AI side panel of an AI DM: it finds the AI by the chat's jid and edits its
 * name, persona and limits, plus Delete. It slides in from the right, matching
 * the app's other sheets.
 */
export function AiPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const navigate = useNavigate();
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  // T-0080: the owner kill switch. `confirmingStop` mirrors the delete
  // confirm step (one tap to arm, one tap to act) so a stray click on the
  // destructive button is harmless. While the network call is in flight the
  // button stays disabled and an inline error shows on failure, like the
  // other panel actions.
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [stopError, setStopError] = useState('');
  const [resumeError, setResumeError] = useState('');
  // T-0091: the home machine. `machines` is the owner's full list, kept
  // here so the dropdown stays in sync with the Machines page even after a
  // revoke. The select is disabled when the load failed, and the only
  // option is the AI's current value. While the network call is in flight
  // the select stays disabled too — the pending state is the disabled
  // state, exactly like the kill switch. `machineError` is the inline
  // failure message; on success we clear it.
  const [machineError, setMachineError] = useState('');
  // T-0478: the owner's delegation opt-ins. Each switch saves on its own
  // through `updateAi`, separate from the main form's Save.
  const [delegationError, setDelegationError] = useState('');

  // Seeds the form from the AI the panel shows. A later save replaces these values.
  const seedForm = (next: PublicAi): void => {
    setAi(next);
    setName(next.name);
    setPersona(next.persona);
    setDay(String(next.limits.perDayUsd));
    setMonth(String(next.limits.perMonthUsd));
    setSelectedConnectionId(next.providerConnectionId);
    setModelDraft(next.model);
  };

  // The panel's AI is the one whose jid is this chat's id. The list is read
  // once per chat; the result seeds the panel, or shows why it could not.
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

  // The model picker still works without connections: a failed read just offers
  // no provider suggestions, and the connection picker stays hidden.
  const [connectionList] = useQuery(() => fromApi(() => listConnections()), []);
  const connections: Connection[] = AsyncResult.isSuccess(connectionList)
    ? connectionList.value.filter((connection) => connection.status === 'active')
    : [];

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
  const currentMachineId = ai?.machineId ?? null;
  // The current value always shows, even if the machine vanished or was
  // revoked in another tab — without it the dropdown would default to
  // "The platform", which would be a silent change.
  const knownMachineIds = new Set(approvedMachines.map((machine) => machine.id));
  const currentMachineIsKnown = currentMachineId === null || knownMachineIds.has(currentMachineId);

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
  // The model and connection diffs ride the same patch: the server needs the
  // model whenever the connection changes, so a connection change always
  // carries both, while a model-only change carries just the model.
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

  // Switching provider re-prefills that provider's default model, as in the
  // create dialog: the old model name rarely fits the new provider.
  const chooseConnection = (id: string): void => {
    setSelectedConnectionId(id);
    const next = usableConnections.find((connection) => connection.id === id) ?? null;
    if (next !== null) {
      setModelDraft(defaultModelFor(next.provider));
    }
    markEdited();
  };

  // A combined PATCH can commit one field and fail a later one (the model swaps
  // before the roster rename), so a failure reads the AI again and shows what the
  // server really has. When even that read fails, the form falls back to the
  // values the save started from.
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

  // T-0478: the delegation switches save on their own. On success the fresh
  // AI replaces the local copy; on failure the inline error shows and the
  // switch keeps the old value (we never flip it optimistically).
  const [delegationState, saveDelegation] = useAction<UpdateAiInput, void, never>((input) => {
    if (ai === null) {
      return Effect.void;
    }
    const target = ai;
    return Effect.sync(() => setDelegationError('')).pipe(
      Effect.andThen(fromApi(() => updateAi(target.id, input))),
      Effect.tap((updated) => Effect.sync(() => setAi(updated))),
      Effect.asVoid,
      Effect.catchTag('ApiFailure', (failure) =>
        Effect.sync(() =>
          setDelegationError(describeFailure(failure, 'Could not update the AI').message),
        ),
      ),
    );
  });
  const delegationBusy = isWaiting(delegationState);

  const [deleteState, runDelete] = useAction<void, void, never>(() => {
    if (ai === null) {
      return Effect.void;
    }
    const target = ai;
    return Effect.sync(() => setDeleteError('')).pipe(
      Effect.andThen(fromApi(() => deleteAi(target.id))),
      Effect.tap(() =>
        Effect.sync(() => {
          storeApi.setState((state) => ({
            chats: state.chats.filter((chatItem) => chatItem.id !== chat.id),
          }));
          onClose();
          navigate('/');
        }),
      ),
      Effect.asVoid,
      Effect.catchTag('ApiFailure', (failure) =>
        Effect.sync(() =>
          setDeleteError(describeFailure(failure, 'Could not delete the AI').message),
        ),
      ),
    );
  });
  const deleting = isWaiting(deleteState);

  // T-0080: stop the AI. The server returns the fresh public AI so the
  // panel re-renders against the server truth (the `stopped` label appears
  // immediately); a 409 (the AI was already in another terminal state)
  // refetches to align the UI with the server.
  const [stopState, runStop] = useAction<void, void, never>(() => {
    if (ai === null) {
      return Effect.void;
    }
    const target = ai;
    return Effect.sync(() => setStopError('')).pipe(
      Effect.andThen(fromApi(() => stopAi(target.id))),
      Effect.tap((fresh) => Effect.sync(() => setAi(fresh))),
      Effect.asVoid,
      Effect.catchTag('ApiFailure', (failure) =>
        Effect.sync(() =>
          setStopError(describeFailure(failure, 'Could not stop the AI').message),
        ).pipe(Effect.andThen(refetchAi(target.id, setAi))),
      ),
      Effect.ensuring(Effect.sync(() => setConfirmingStop(false))),
    );
  });
  const stopping = isWaiting(stopState);

  // T-0080: resume. Same shape as the stop action: the server's answer is the
  // source of truth for the new status, and a failure reads the AI again.
  const [resumeState, runResume] = useAction<void, void, never>(() => {
    if (ai === null) {
      return Effect.void;
    }
    const target = ai;
    return Effect.sync(() => setResumeError('')).pipe(
      Effect.andThen(fromApi(() => resumeAi(target.id))),
      Effect.tap((fresh) => Effect.sync(() => setAi(fresh))),
      Effect.asVoid,
      Effect.catchTag('ApiFailure', (failure) =>
        Effect.sync(() =>
          setResumeError(describeFailure(failure, 'Could not resume the AI').message),
        ).pipe(Effect.andThen(refetchAi(target.id, setAi))),
      ),
    );
  });
  const resuming = isWaiting(resumeState);

  // T-0091: set or clear the home machine. The select carries the chosen
  // value already (`event.target.value`), so on a failure we have to roll
  // it back to the AI's previous value: the select itself is uncontrolled
  // and uses `ai.machineId` as the canonical source.
  // The select only carries approved machines plus "The platform", so a chosen id
  // is by construction known to the server. Still, the server is the source of
  // truth; on a 404 (a revoke that raced us) the panel reads the AI again instead
  // of crashing. A second change while one is in flight is dropped.
  const [machineState, runMachine] = useAction<string, void, never>((nextValue) => {
    if (ai === null) {
      return Effect.void;
    }
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
    <>
      <Sheet open onClose={onClose} ariaLabel={`${chat.title} AI settings`}>
        <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
          <Avatar
            id={ai?.id ?? chat.id}
            name={ai?.name ?? chat.title}
            size={44}
            ai
            avatarUrl={ai?.avatarUrl ?? chat.avatarUrl}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[16px] font-semibold">{ai?.name ?? chat.title}</span>
              <AiBadge />
              {/* T-0080: a stopped AI gets a clear "Stopped" label near the
                  name so the owner sees the kill-switch state at a glance,
                  even before opening the panel body. */}
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
              <label className="flex flex-col gap-1">
                <span className="text-[14px] font-medium">Name</span>
                <TextInput
                  aria-label="Name"
                  value={name}
                  maxLength={64}
                  onChange={(event) => {
                    setName(event.target.value);
                    markEdited();
                  }}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[14px] font-medium">Persona</span>
                <TextArea
                  aria-label="Persona"
                  rows={10}
                  maxLength={4000}
                  value={persona}
                  onChange={(event) => {
                    setPersona(event.target.value);
                    markEdited();
                  }}
                  placeholder="Describe how this AI should behave…"
                  className="min-h-0"
                />
              </label>

              {usableConnections.length > 1 && (
                <div className="flex flex-col gap-2">
                  <span className="text-[14px] font-medium">Provider</span>
                  <ConnectionPicker
                    connections={usableConnections}
                    value={selectedConnectionId}
                    onChange={chooseConnection}
                  />
                </div>
              )}

              <ModelPicker
                provider={effectiveConnection?.provider ?? ''}
                suggestions={
                  effectiveConnection === null
                    ? []
                    : modelSuggestionsFor(effectiveConnection.provider)
                }
                value={modelDraft}
                onChange={(next) => {
                  setModelDraft(next);
                  markEdited();
                }}
                inputId="ai-panel-model"
              />

              {/* T-0091: the home machine. A labelled select listing the
                  owner's approved machines plus "The platform (no machine)".
                  When the machine list could not be loaded, the select is
                  disabled and shows the current value only — it cannot show
                  "The platform" by default, that would silently change the
                  AI's home. The same applies when the AI is on a machine
                  that has since been revoked in another tab: the value
                  still renders so the owner sees what the AI is on, just
                  without the option to keep it that way. */}
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

              <UsageBlock ai={ai} />

              {/* T-0478: the owner's delegation opt-ins. Each switch saves
                  immediately; on failure the inline error shows and the
                  switch keeps its old value. */}
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
                      Other AIs in a group can hand this AI tasks. It works on them with its own
                      model and budget
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

              <AiMemorySection chat={chat.id} aiId={ai.id} aiName={ai.name} />

              {/* T-0165: the AI's picture, for the AI's owner. */}
              <AiPictureSection ai={ai} onChanged={setAi} />

              <LimitsFields
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

              {/* T-0080: the owner's kill switch. When the AI is `active` a
                  Stop button arms the destructive action (matching the
                  delete confirm); when the AI is `stopped` a Resume button
                  brings it back without a confirm step (the call is
                  idempotent on `active` already, so it cannot fail loudly).
                  Inline errors land in `stopError` / `resumeError` like the
                  other panel actions. The error renders above the buttons,
                  not inside the confirm branch, so it survives the
                  confirm step resetting on a failed call. */}
              <div className="mt-1 flex flex-col gap-2 border-t border-divider pt-4">
                {ai.status === 'active' && stopError !== '' && <FieldError>{stopError}</FieldError>}
                {ai.status === 'active' &&
                  (confirmingStop ? (
                    <>
                      <p className="text-[14px] text-danger">
                        Stop {ai.name}? It goes offline at once and any reply in flight is dropped.
                        Resume to bring it back.
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          size="lg"
                          className="rounded-full px-4"
                          disabled={stopping}
                          onClick={() => runStop()}
                        >
                          {stopping ? 'Stopping…' : 'Stop AI'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="lg"
                          className="rounded-full px-4"
                          disabled={stopping}
                          onClick={() => {
                            setConfirmingStop(false);
                            setStopError('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="destructive"
                      size="lg"
                      className="self-start rounded-full px-4"
                      onClick={() => {
                        setConfirmingStop(true);
                        setStopError('');
                      }}
                    >
                      Stop AI
                    </Button>
                  ))}
                {ai.status === 'stopped' && (
                  <>
                    {resumeError !== '' && <FieldError>{resumeError}</FieldError>}
                    <Button
                      type="button"
                      size="lg"
                      className="self-start rounded-full px-4"
                      disabled={resuming}
                      onClick={() => runResume()}
                    >
                      {resuming ? 'Resuming…' : 'Resume'}
                    </Button>
                  </>
                )}
              </div>

              <div className="mt-1 flex flex-col gap-2 border-t border-divider pt-4">
                {confirmingDelete ? (
                  <>
                    <p className="text-[14px] text-danger">
                      Delete {ai.name}? This removes the AI and its chat. Your provider connection
                      stays.
                    </p>
                    {deleteError !== '' && <FieldError>{deleteError}</FieldError>}
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="destructive"
                        size="lg"
                        className="rounded-full px-4"
                        disabled={deleting}
                        onClick={() => runDelete()}
                      >
                        {deleting ? 'Deleting…' : 'Delete'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="lg"
                        className="rounded-full px-4"
                        disabled={deleting}
                        onClick={() => {
                          setConfirmingDelete(false);
                          setDeleteError('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="destructive"
                    size="lg"
                    className="self-start rounded-full px-4"
                    onClick={() => {
                      setConfirmingDelete(true);
                      setDeleteError('');
                    }}
                  >
                    Delete
                  </Button>
                )}
              </div>

              <AiActivity aiId={ai.id} />

              <AlwaysAllowedList scope={{ aiId: ai.id }} />

              {/* T-0107: tools and routines of this AI. The panel mounts for
                  the AI owner only, so every action is allowed. */}
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
