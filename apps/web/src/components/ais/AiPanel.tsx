import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ChatSummary } from '@zilar/chat-core';
import { X } from 'lucide-react';
import {
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
  type Machine,
  type PublicAi,
  type UpdateAiInput,
} from '@/lib/api';
import { AiBadge } from '@/components/AiBadge';
import { Avatar } from '@/components/Avatar';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';
import { Button, FieldError } from './AiPageShell';
import { AiActivity } from './AiActivity';
import { AlwaysAllowedList } from '@/components/approvals/AlwaysAllowedList';
import { RoutinesSection } from '@/components/tools/RoutinesSection';
import { ToolsSection } from '@/components/tools/ToolsSection';
import { ConnectionPicker } from './ConnectionPicker';
import { describeAiError } from './errors';
import { LimitsFields } from './LimitsFields';
import { validateLimits } from './limits';
import { ModelPicker } from './ModelPicker';
import { defaultModelFor, modelSuggestionsFor } from './models';
import { buildPatch } from './aiForm';

type PanelStatus = 'loading' | 'ready' | 'missing' | 'error';

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
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  // T-0080: the owner kill switch. `confirmingStop` mirrors the delete
  // confirm step (one tap to arm, one tap to act) so a stray click on the
  // destructive button is harmless. While the network call is in flight the
  // button stays disabled and an inline error shows on failure, like the
  // other panel actions.
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState('');
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState('');
  // T-0091: the home machine. `machines` is the owner's full list, kept
  // here so the dropdown stays in sync with the Machines page even after a
  // revoke. The select is disabled when the load failed, and the only
  // option is the AI's current value. While the network call is in flight
  // the select stays disabled too — the pending state is the disabled
  // state, exactly like the kill switch. `machineError` is the inline
  // failure message; on success we clear it.
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [machineBusy, setMachineBusy] = useState(false);
  const [machineError, setMachineError] = useState('');

  useEffect(() => {
    let active = true;
    listAis()
      .then((list) => {
        if (!active) {
          return;
        }
        const found = list.find((item) => item.jid === chat.id) ?? null;
        if (found === null) {
          setStatus('missing');
          return;
        }
        setAi(found);
        setName(found.name);
        setPersona(found.persona);
        setDay(String(found.limits.perDayUsd));
        setMonth(String(found.limits.perMonthUsd));
        setSelectedConnectionId(found.providerConnectionId);
        setModelDraft(found.model);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setErrorMessage(describeAiError(error, 'Could not load the AI').message);
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [chat.id]);

  useEffect(() => {
    let active = true;
    listConnections()
      .then((list) => {
        if (!active) {
          return;
        }
        setConnections(list.filter((connection) => connection.status === 'active'));
      })
      .catch(() => {
        // The model picker still works without connections: it just offers no
        // provider suggestions, and the connection picker stays hidden.
        if (active) {
          setConnections([]);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // T-0091: the home machine dropdown lists the owner's approved machines.
  // A failure here must not block the rest of the panel: we keep
  // `machines` null so the select can render its disabled "current value
  // only" state.
  useEffect(() => {
    let active = true;
    listMachines()
      .then((list) => {
        if (active) {
          setMachines(list);
        }
      })
      .catch(() => {
        if (active) {
          setMachines(null);
        }
      });
    return () => {
      active = false;
    };
  }, []);

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
  const machineSelectDisabled = !machineOptionsLoaded || machineBusy;

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
  const canSave =
    ai !== null &&
    name.trim() !== '' &&
    modelTrimmed !== '' &&
    limits.limits !== null &&
    patch !== null &&
    !busy;

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

  const save = async (): Promise<void> => {
    if (ai === null || patch === null || !canSave) {
      return;
    }
    setBusy(true);
    setSaveError('');
    try {
      const updated = await updateAi(ai.id, patch);
      setAi(updated);
      setName(updated.name);
      setPersona(updated.persona);
      setDay(String(updated.limits.perDayUsd));
      setMonth(String(updated.limits.perMonthUsd));
      setSelectedConnectionId(updated.providerConnectionId);
      setModelDraft(updated.model);
      setSaved(true);
      storeApi.setState((state) => ({
        chats: state.chats.map((chatItem) =>
          chatItem.id === chat.id ? { ...chatItem, title: updated.name } : chatItem,
        ),
      }));
    } catch (error) {
      setSaveError(describeAiError(error, 'Could not update the AI').message);
      // A combined PATCH can commit one field and fail a later one (the model
      // swaps before the roster rename), so show what the server really has
      // instead of the stale snapshot. When even that fails, fall back to it.
      try {
        const fresh = await getAi(ai.id);
        setAi(fresh);
        setName(fresh.name);
        setPersona(fresh.persona);
        setDay(String(fresh.limits.perDayUsd));
        setMonth(String(fresh.limits.perMonthUsd));
        setSelectedConnectionId(fresh.providerConnectionId);
        setModelDraft(fresh.model);
      } catch {
        setSelectedConnectionId(ai.providerConnectionId);
        setModelDraft(ai.model);
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (ai === null) {
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteAi(ai.id);
      storeApi.setState((state) => ({
        chats: state.chats.filter((chatItem) => chatItem.id !== chat.id),
      }));
      onClose();
      navigate('/');
    } catch (error) {
      setDeleteError(describeAiError(error, 'Could not delete the AI').message);
      setDeleting(false);
    }
  };

  // T-0080: stop the AI. The server returns the fresh public AI so the
  // panel re-renders against the server truth (the `stopped` label appears
  // immediately); a 409 (the AI was already in another terminal state)
  // refetches to align the UI with the server.
  const confirmStop = async (): Promise<void> => {
    if (ai === null) {
      return;
    }
    setStopping(true);
    setStopError('');
    try {
      const fresh = await stopAi(ai.id);
      setAi(fresh);
    } catch (error) {
      setStopError(describeAiError(error, 'Could not stop the AI').message);
      try {
        setAi(await getAi(ai.id));
      } catch {
        // The refetch is best-effort; the inline error stays visible.
      }
    } finally {
      setStopping(false);
      setConfirmingStop(false);
    }
  };

  // T-0080: resume. Same shape as `confirmStop`: the server's answer is the
  // source of truth for the new status, and a 409 just refetches.
  const confirmResume = async (): Promise<void> => {
    if (ai === null) {
      return;
    }
    setResuming(true);
    setResumeError('');
    try {
      const fresh = await resumeAi(ai.id);
      setAi(fresh);
    } catch (error) {
      setResumeError(describeAiError(error, 'Could not resume the AI').message);
      try {
        setAi(await getAi(ai.id));
      } catch {
        // The refetch is best-effort; the inline error stays visible.
      }
    } finally {
      setResuming(false);
    }
  };

  // T-0091: set or clear the home machine. The select carries the chosen
  // value already (`event.target.value`), so on a failure we have to roll
  // it back to the AI's previous value: the select itself is uncontrolled
  // and uses `ai.machineId` as the canonical source.
  const changeMachine = async (nextValue: string): Promise<void> => {
    if (ai === null || machineBusy) {
      return;
    }
    const previous = ai.machineId ?? null;
    const next = nextValue === '' ? null : nextValue;
    if (next === previous) {
      return;
    }
    // The select only carries approved machines plus "The platform", so a
    // chosen id is by construction known to the server. Still, the server
    // is the source of truth; on a 404 (a revoke that raced us) we refetch
    // instead of crashing the panel.
    const optimistic: PublicAi = { ...ai, machineId: next };
    setAi(optimistic);
    setMachineBusy(true);
    setMachineError('');
    try {
      const fresh = await setAiMachine(ai.id, next);
      setAi(fresh);
    } catch (error) {
      // Roll back to the AI's previous value, then refetch so the panel
      // matches the server's view. The refetch is best-effort: the inline
      // error stays visible either way.
      setAi((current) => (current === null ? current : { ...current, machineId: previous }));
      setMachineError(describeAiError(error, 'Could not update the home machine').message);
      try {
        const fresh = await getAi(ai.id);
        setAi(fresh);
      } catch {
        // The refetch is best-effort; the inline error stays visible.
      }
    } finally {
      setMachineBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${chat.title} AI settings`}
      onClick={onClose}
      className="fixed inset-0 z-40 flex justify-end bg-black/40"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-sm flex-col bg-background shadow-xl sm:w-[380px]"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
          <Avatar id={ai?.id ?? chat.id} name={ai?.name ?? chat.title} size={44} />
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
          <button
            type="button"
            aria-label="Close AI panel"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {status === 'loading' && <p className="text-[15px] text-muted-foreground">Loading…</p>}

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
                <input
                  aria-label="Name"
                  value={name}
                  maxLength={64}
                  onChange={(event) => {
                    setName(event.target.value);
                    markEdited();
                  }}
                  className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[14px] font-medium">Persona</span>
                <textarea
                  aria-label="Persona"
                  rows={10}
                  maxLength={4000}
                  value={persona}
                  onChange={(event) => {
                    setPersona(event.target.value);
                    markEdited();
                  }}
                  placeholder="Describe how this AI should behave…"
                  className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
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
                  onChange={(event) => void changeMachine(event.target.value)}
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
                          onClick={() => void confirmStop()}
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
                      onClick={() => void confirmResume()}
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
                        onClick={() => void confirmDelete()}
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
              onClick={() => void save()}
            >
              {busy ? (switchingModel ? 'Switching model…' : 'Saving…') : 'Save'}
            </Button>
          </footer>
        )}
      </div>
    </div>
  );
}
