import { useState } from 'react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import type { ChatSummary } from '@zilar/chat-core';
import { X } from 'lucide-react';
import {
  getAi,
  listAis,
  listConnections,
  updateAi,
  type Connection,
  type PublicAi,
  type UpdateAiInput,
} from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { AiBadge } from '@/components/AiBadge';
import { Avatar } from '@/components/Avatar';
import { Sheet } from '@/components/ui/sheet';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { StateMessage } from '@/components/ui/state-message';
import { Button } from '@/components/ui/button';
import { FieldError } from './AiPageShell';
import { AiActivity } from './AiActivity';
import { AiMemorySection } from './AiMemorySection';
import { AlwaysAllowedList } from '@/components/approvals/AlwaysAllowedList';
import { RoutinesSection } from '@/components/tools/RoutinesSection';
import { ToolsSection } from '@/components/tools/ToolsSection';
import { describeFailure, type PanelStatus } from './aiPanelOps';
import { AiFormFields, AiLimitsFields } from './AiFormFields';
import { AiMachineSection } from './AiMachineSection';
import { AiDelegationSection } from './AiDelegationSection';
import { AiDangerZone } from './AiDangerZone';
import { AiPictureSection } from './AiPictureSection';
import { UsageBlock } from './AiUsageSection';
import { validateLimits } from './limits';
import { defaultModelFor, modelSuggestionsFor } from './models';
import { buildPatch } from './aiForm';

export { UsageBlock };

/**
 * The AI side panel of an AI DM: it finds the AI by the chat's jid and edits its
 * name, persona and limits, plus Delete. It slides in from the right, matching
 * the app's other sheets.
 */
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

              <UsageBlock ai={ai} />

              <AiDelegationSection ai={ai} setAi={setAi} />

              <AiMemorySection chat={chat.id} aiId={ai.id} aiName={ai.name} />

              {/* T-0165: the AI's picture, for the AI's owner. */}
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
