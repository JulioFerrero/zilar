import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { MessageSquare, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import {
  deleteAi,
  listAis,
  listConnections,
  updateAi,
  type AiLimits,
  type PublicAi,
  type UpdateAiInput,
} from '@/lib/api';
import { AiBadge } from '@/components/AiBadge';
import { Avatar } from '@/components/Avatar';
import { AiPageShell, Button, FieldError } from '@/components/ais/AiPageShell';
import { providerLabel } from '@/components/ais/ConnectionPicker';
import { describeAiError } from '@/components/ais/errors';
import { LimitsFields } from '@/components/ais/LimitsFields';
import { formatLimit, validateLimits } from '@/components/ais/limits';
import { templateLabel } from '@/components/ais/templates';

type PageStatus = 'loading' | 'ready' | 'error';

export function AisPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const highlightId = readHighlightId(location.state);

  const [ais, setAis] = useState<PublicAi[]>([]);
  const [providers, setProviders] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<PageStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState<PublicAi | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await listAis();
      setAis(list);
      setStatus('ready');
      setErrorMessage('');
      void loadProviderNames(list, setProviders);
    } catch (error) {
      setErrorMessage(describeAiError(error, 'Could not load your AIs').message);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    let active = true;
    void listAis()
      .then((list) => {
        if (!active) {
          return;
        }
        setAis(list);
        setStatus('ready');
        setErrorMessage('');
        void loadProviderNames(list, setProviders);
      })
      .catch((error: unknown) => {
        if (active) {
          setErrorMessage(describeAiError(error, 'Could not load your AIs').message);
          setStatus('error');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const retry = (): void => {
    setStatus('loading');
    void load();
  };

  const confirmDelete = async (id: string): Promise<void> => {
    setActionError('');
    setDeletingId(id);
    try {
      await deleteAi(id);
      setAis((previous) => previous.filter((ai) => ai.id !== id));
      setConfirmingId(null);
    } catch (error) {
      setActionError(describeAiError(error, 'Could not delete the AI').message);
    } finally {
      setDeletingId(null);
    }
  };

  const saveEdit = async (ai: PublicAi, input: UpdateAiInput): Promise<void> => {
    const updated = await updateAi(ai.id, input);
    setAis((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
  };

  return (
    <AiPageShell
      title="My AIs"
      subtitle="Your AIs, their model and their spending limits."
      onBack={() => navigate('/')}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        {status === 'loading' && <p className="text-[15px] text-muted-foreground">Loading…</p>}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 text-center">
            <p role="alert" className="text-[15px] text-danger">
              {errorMessage}
            </p>
            <Button type="button" size="lg" className="rounded-full px-5" onClick={retry}>
              Retry
            </Button>
          </div>
        )}

        {status === 'ready' && ais.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Zap className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-[15px] text-muted-foreground">
              You have no AIs yet. Create one to give it a chat account and a budget.
            </p>
            <Button
              type="button"
              size="lg"
              className="rounded-full px-5"
              onClick={() => navigate('/settings/ais/new')}
            >
              Create an AI
            </Button>
          </div>
        )}

        {status === 'ready' && ais.length > 0 && (
          <>
            <Button
              type="button"
              size="lg"
              className="self-start rounded-full px-5"
              onClick={() => navigate('/settings/ais/new')}
            >
              <Plus aria-hidden="true" />
              Create AI
            </Button>

            <ul className="flex flex-col gap-1">
              {ais.map((ai) => (
                <li key={ai.id}>
                  {editing?.id === ai.id ? (
                    <EditAiForm
                      ai={ai}
                      onCancel={() => {
                        setEditing(null);
                        setActionError('');
                      }}
                      onSave={(input) => saveEdit(ai, input)}
                      onSaved={() => setEditing(null)}
                    />
                  ) : (
                    <AiRow
                      ai={ai}
                      providerName={providers[ai.providerConnectionId]}
                      highlighted={ai.id === highlightId}
                      confirming={confirmingId === ai.id}
                      deleting={deletingId === ai.id}
                      actionError={confirmingId === ai.id ? actionError : ''}
                      onOpenChat={() => navigate(`/c/${encodeURIComponent(ai.jid)}`)}
                      onEdit={() => {
                        setActionError('');
                        setEditing(ai);
                      }}
                      onAskDelete={() => {
                        setActionError('');
                        setConfirmingId(ai.id);
                      }}
                      onCancelDelete={() => {
                        setActionError('');
                        setConfirmingId(null);
                      }}
                      onConfirmDelete={() => void confirmDelete(ai.id)}
                    />
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </AiPageShell>
  );
}

function AiRow({
  ai,
  providerName,
  highlighted,
  confirming,
  deleting,
  actionError,
  onOpenChat,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  ai: PublicAi;
  providerName: string | undefined;
  highlighted: boolean;
  confirming: boolean;
  deleting: boolean;
  actionError: string;
  onOpenChat: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  return (
    <div
      className={
        highlighted
          ? 'flex items-start gap-3 rounded-xl border border-accent bg-accent/5 px-3 py-2.5 transition-colors'
          : 'flex items-start gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:bg-list-hover'
      }
    >
      <Avatar id={ai.id} name={ai.name} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[16px] font-semibold">{ai.name}</span>
          <AiBadge />
          {ai.status !== 'active' && (
            <span className="rounded-full bg-badge-muted px-2 py-0.5 text-[11px] text-foreground">
              {ai.status}
            </span>
          )}
        </div>
        <p className="text-[13px] text-muted-foreground">
          {templateLabel(ai.template)} · {ai.model}
          {providerName === undefined ? '' : ` · ${providerName}`}
        </p>
        <p className="text-[13px] text-muted-foreground">
          {formatLimit(ai.limits.perDayUsd)}/day · {formatLimit(ai.limits.perMonthUsd)}/month
        </p>
        {confirming && (
          <>
            <p className="mt-1 text-[13px] text-danger">
              This removes the AI's chat account and its provider key.
            </p>
            {actionError !== '' && <FieldError>{actionError}</FieldError>}
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {confirming ? (
          <>
            <button
              type="button"
              disabled={deleting}
              onClick={onConfirmDelete}
              className="rounded-full bg-danger px-3 py-1.5 text-[14px] font-medium text-white hover:bg-danger/90 disabled:opacity-50"
            >
              Remove
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={onCancelDelete}
              className="rounded-full px-3 py-1.5 text-[14px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              aria-label={`Open chat with ${ai.name}`}
              onClick={onOpenChat}
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <MessageSquare className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Edit ${ai.name}`}
              onClick={onEdit}
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Pencil className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Delete ${ai.name}`}
              onClick={onAskDelete}
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function EditAiForm({
  ai,
  onCancel,
  onSave,
  onSaved,
}: {
  ai: PublicAi;
  onCancel: () => void;
  onSave: (input: UpdateAiInput) => Promise<void>;
  onSaved: () => void;
}) {
  const [name, setName] = useState(ai.name);
  const [persona, setPersona] = useState(ai.persona);
  const [day, setDay] = useState(String(ai.limits.perDayUsd));
  const [month, setMonth] = useState(String(ai.limits.perMonthUsd));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const limits = validateLimits(day, month);

  const submit = async (): Promise<void> => {
    const patch = buildPatch({
      name,
      originalName: ai.name,
      persona,
      originalPersona: ai.persona,
      limits: limits.limits,
      originalLimits: ai.limits,
    });
    if (name.trim() === '' || limits.limits === null || patch === null) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave(patch);
      onSaved();
    } catch (cause) {
      setError(describeAiError(cause, 'Could not update the AI').message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-divider bg-background p-4">
      <h2 className="text-[16px] font-semibold">Edit {ai.name}</h2>

      <label className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">Name</span>
        <input
          value={name}
          maxLength={64}
          onChange={(event) => setName(event.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">Persona</span>
        <textarea
          rows={5}
          maxLength={4000}
          value={persona}
          onChange={(event) => setPersona(event.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
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

      {error !== '' && <FieldError>{error}</FieldError>}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="lg"
          className="rounded-full px-4"
          disabled={busy || name.trim() === '' || limits.limits === null}
          onClick={() => void submit()}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="rounded-full px-4"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** PATCH carries only the fields that actually changed; null means nothing did. */
export function buildPatch(input: {
  name: string;
  originalName: string;
  persona: string;
  originalPersona: string;
  limits: AiLimits | null;
  originalLimits: AiLimits;
}): UpdateAiInput | null {
  const patch: UpdateAiInput = {};
  if (input.name.trim() !== input.originalName) {
    patch.name = input.name.trim();
  }
  if (input.persona.trim() !== input.originalPersona) {
    patch.persona = input.persona.trim();
  }
  if (
    input.limits !== null &&
    (input.limits.perDayUsd !== input.originalLimits.perDayUsd ||
      input.limits.perMonthUsd !== input.originalLimits.perMonthUsd)
  ) {
    patch.limits = input.limits;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

function readHighlightId(state: unknown): string | null {
  if (state !== null && typeof state === 'object' && 'highlightId' in state) {
    const value = (state as { highlightId?: unknown }).highlightId;
    if (typeof value === 'string') {
      return value;
    }
  }
  return null;
}

// The provider name is decoration on a row, never a reason to fail the page.
async function loadProviderNames(
  ais: PublicAi[],
  setProviders: (providers: Record<string, string>) => void,
): Promise<void> {
  if (ais.length === 0) {
    return;
  }
  try {
    const connections = await listConnections();
    const map: Record<string, string> = {};
    for (const connection of connections) {
      map[connection.id] = providerLabel(connection.provider);
    }
    setProviders(map);
  } catch {
    setProviders({});
  }
}
