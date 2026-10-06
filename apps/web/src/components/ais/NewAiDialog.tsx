import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ChatSummary } from '@zilar/chat-core';
import { ChevronDown } from 'lucide-react';
import { createAi, listConnections, type AiTemplate, type Connection } from '@/lib/api';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { Button, FieldError } from './AiPageShell';
import { ConnectionPicker, providerLabel } from './ConnectionPicker';
import { describeAiError } from './errors';
import { LimitsFields } from './LimitsFields';
import { validateLimits } from './limits';
import { ModelPicker } from './ModelPicker';
import { defaultModelFor, modelSuggestionsFor } from './models';
import { AI_TEMPLATE_OPTIONS, defaultPersonaFor } from './templates';
import {
  buildCreateBody,
  DEFAULT_DAILY_USD,
  DEFAULT_MONTHLY_USD,
  type AiFormState,
} from './aiForm';
import { Dialog } from '../ui/dialog';
import { TextArea, TextInput } from '../ui/text-input';
import { cn } from '@/lib/utils';

type DialogStatus = 'loading' | 'ready' | 'unavailable' | 'error';

/**
 * The one-screen "New AI" dialog: a name, a template and Create. Everything else
 * keeps a safe default and lives behind "More options". It mirrors the chrome of
 * NewGroupDialog.
 */
export function NewAiDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const storeApi = useChatStoreApi();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [status, setStatus] = useState<DialogStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [name, setName] = useState('');
  const [template, setTemplate] = useState<AiTemplate>('dev');
  const [persona, setPersona] = useState(defaultPersonaFor('dev'));
  const [personaTouched, setPersonaTouched] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  // null means "use the selected provider's default model".
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [day, setDay] = useState(String(DEFAULT_DAILY_USD));
  const [month, setMonth] = useState(String(DEFAULT_MONTHLY_USD));
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    listConnections()
      .then((list) => {
        if (!active) {
          return;
        }
        setConnections(list.filter((connection) => connection.status === 'active'));
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        const info = describeAiError(error, 'Could not load your connections');
        setErrorMessage(info.message);
        setStatus(info.unavailable ? 'unavailable' : 'error');
      });
    return () => {
      active = false;
    };
  }, []);

  // Esc, the backdrop, Cancel and the actions footer all close via the kit
  // `Dialog`; the focus effect below still moves focus into the name input.

  const effectiveConnection =
    connections.length === 1
      ? connections[0]!
      : (connections.find((connection) => connection.id === selectedConnectionId) ?? null);

  const model =
    modelDraft ??
    (effectiveConnection === null ? '' : defaultModelFor(effectiveConnection.provider));

  const limits = validateLimits(day, month);
  const providerConnectionId = effectiveConnection?.id ?? null;
  const customNeedsPersona = template === 'custom' && persona.trim() === '';
  const canSubmit =
    name.trim() !== '' &&
    providerConnectionId !== null &&
    model.trim() !== '' &&
    limits.limits !== null &&
    !customNeedsPersona &&
    !submitting;

  const chooseTemplate = (next: AiTemplate): void => {
    setTemplate(next);
    setPersona(defaultPersonaFor(next));
    setPersonaTouched(false);
  };

  const chooseConnection = (id: string): void => {
    setSelectedConnectionId(id);
    // Switching provider re-prefills that provider's default model.
    setModelDraft(null);
  };

  const submit = async (): Promise<void> => {
    if (inFlight.current) {
      return;
    }
    const form: AiFormState = {
      name,
      template,
      persona,
      personaTouched,
      providerConnectionId,
      model,
      day,
      month,
    };
    const body = buildCreateBody(form, limits.limits);
    if (body === null || !canSubmit) {
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError('');
    try {
      const created = await createAi(body);
      const summary: ChatSummary = {
        id: created.jid,
        title: created.name,
        kind: 'dm',
        isAI: true,
        space: 'personal',
        unread: 0,
        muted: false,
        online: false,
      };
      // Show the new AI in the list immediately. The store's T-0033 roster
      // refresh reconciles it a moment later; a chat already there is kept.
      storeApi.setState((state) => ({
        chats: state.chats.some((chat) => chat.id === created.jid)
          ? state.chats
          : [summary, ...state.chats],
      }));
      onClose();
      navigate(`/c/${encodeURIComponent(created.jid)}`);
    } catch (error) {
      setSubmitError(describeAiError(error, 'Could not create the AI').message);
      setSubmitting(false);
      inFlight.current = false;
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="New AI"
      size="sm"
      actions={
        <>
          <Button type="button" variant="ghost" size="lg" onClick={onClose}>
            Cancel
          </Button>
          {status === 'ready' && connections.length > 0 && (
            <Button type="button" size="lg" disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? 'Creating…' : 'Create'}
            </Button>
          )}
        </>
      }
    >
      <div className="mt-3">
        {status === 'loading' && <p className="text-[15px] text-muted-foreground">Loading…</p>}

        {(status === 'unavailable' || status === 'error') && (
          <p role="alert" className="text-[15px] text-danger">
            {errorMessage}
          </p>
        )}

        {status === 'ready' && connections.length === 0 && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[15px] text-muted-foreground">
              Add a provider key first, then come back to create an AI.
            </p>
            <Button
              type="button"
              size="lg"
              className="rounded-full px-5"
              onClick={() => {
                onClose();
                navigate('/settings/connections');
              }}
            >
              Connections
            </Button>
          </div>
        )}

        {status === 'ready' && connections.length > 0 && (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-[14px] font-medium">Name</span>
              <TextInput
                autoFocus
                aria-label="Name"
                value={name}
                maxLength={64}
                onChange={(event) => setName(event.target.value)}
                placeholder="Dev-1"
              />
            </label>

            <div className="flex flex-col gap-2">
              <span className="text-[14px] font-medium">Template</span>
              <div role="radiogroup" aria-label="Template" className="flex flex-wrap gap-2">
                {AI_TEMPLATE_OPTIONS.map((option) => {
                  const selected = option.id === template;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => chooseTemplate(option.id)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-[14px] transition-colors',
                        selected
                          ? 'border-accent bg-accent/10 font-medium text-accent'
                          : 'border-divider text-muted-foreground hover:bg-list-hover hover:text-foreground',
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {connections.length === 1 && (
              <p className="text-[13px] text-muted-foreground">
                Using {providerLabel(connections[0]!.provider)}.
              </p>
            )}

            {connections.length > 1 && (
              <div className="flex flex-col gap-2">
                <span className="text-[14px] font-medium">Provider</span>
                <ConnectionPicker
                  connections={connections}
                  value={selectedConnectionId}
                  onChange={chooseConnection}
                />
              </div>
            )}

            <div className="flex flex-col gap-3 border-t border-divider pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={moreOptionsOpen}
                onClick={() => setMoreOptionsOpen((value) => !value)}
                className="self-start px-1 text-[14px] font-medium text-accent hover:text-accent"
              >
                More options
                <ChevronDown
                  className={cn('size-4 transition-transform', moreOptionsOpen && 'rotate-180')}
                  aria-hidden="true"
                />
              </Button>

              {moreOptionsOpen && (
                <div className="flex flex-col gap-4">
                  <ModelPicker
                    provider={effectiveConnection?.provider ?? ''}
                    suggestions={
                      effectiveConnection === null
                        ? []
                        : modelSuggestionsFor(effectiveConnection.provider)
                    }
                    value={model}
                    onChange={(next) => {
                      setModelDraft(next);
                    }}
                  />

                  <label className="flex flex-col gap-1">
                    <span className="text-[14px] font-medium">Persona</span>
                    <TextArea
                      aria-label="Persona"
                      rows={5}
                      maxLength={4000}
                      value={persona}
                      onChange={(event) => {
                        setPersona(event.target.value);
                        setPersonaTouched(true);
                      }}
                      placeholder="Describe how this AI should behave…"
                      className="min-h-0"
                    />
                  </label>

                  <LimitsFields
                    day={day}
                    month={month}
                    dayError={limits.dayError}
                    monthError={limits.monthError}
                    onDayChange={setDay}
                    onMonthChange={setMonth}
                  />
                </div>
              )}
            </div>

            {submitError !== '' && <FieldError>{submitError}</FieldError>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
