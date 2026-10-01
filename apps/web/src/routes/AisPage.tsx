import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { MessageSquare, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { deleteAi, listAis, listConnections, type PublicAi } from '@/lib/api';
import { AiBadge } from '@/components/AiBadge';
import { Avatar } from '@/components/Avatar';
import { Button, FieldError } from '@/components/ais/AiPageShell';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { providerLabel } from '@/components/ais/ConnectionPicker';
import { describeAiError } from '@/components/ais/errors';
import { formatLimit } from '@/components/ais/limits';
import { NewAiDialog } from '@/components/ais/NewAiDialog';
import { templateLabel } from '@/components/ais/templates';

type PageStatus = 'loading' | 'ready' | 'error';

/** `$2` -> `$2.00`. Server amounts are plain USD numbers. */
function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function AisPage() {
  const navigate = useNavigate();

  const [ais, setAis] = useState<PublicAi[]>([]);
  const [providers, setProviders] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<PageStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [creating, setCreating] = useState(false);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

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

  return (
    <SettingsShell
      title="My AIs"
      subtitle="Your AIs, their model and their spending limits."
      onBack={() => navigate('/')}
    >
      <div className={SETTINGS_COLUMN}>
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
              onClick={() => setCreating(true)}
            >
              Create an AI
            </Button>
          </div>
        )}

        {status === 'ready' && ais.length > 0 && (
          <section aria-label="Your AIs" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[16px] font-semibold">Your AIs</h2>
              <Button
                type="button"
                size="lg"
                className="rounded-full px-5"
                onClick={() => setCreating(true)}
              >
                <Plus aria-hidden="true" />
                Create AI
              </Button>
            </div>

            <ul className="flex flex-col gap-2">
              {ais.map((ai) => (
                <li key={ai.id}>
                  <AiRow
                    ai={ai}
                    providerName={providers[ai.providerConnectionId]}
                    confirming={confirmingId === ai.id}
                    deleting={deletingId === ai.id}
                    actionError={confirmingId === ai.id ? actionError : ''}
                    onOpenChat={() => navigate(`/c/${encodeURIComponent(ai.jid)}`)}
                    onEdit={() => navigate(`/c/${encodeURIComponent(ai.jid)}?panel=ai`)}
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
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {creating && <NewAiDialog onClose={() => setCreating(false)} />}
    </SettingsShell>
  );
}

function AiRow({
  ai,
  providerName,
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
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Avatar id={ai.id} name={ai.name} size={44} />
      <div className="min-w-0 flex-1 basis-40">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-medium">{ai.name}</span>
          <AiBadge />
          {ai.status !== 'active' && (
            <span className="rounded-full bg-badge-muted px-2 py-0.5 text-[11px] text-foreground">
              {ai.status}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {templateLabel(ai.template)} · {ai.model}
          {providerName === undefined ? '' : ` · ${providerName}`}
        </p>
        {ai.usage != null && (
          <p className="font-mono text-[12px] text-muted-foreground">
            Today {formatUsd(ai.usage.todayUsd)}
          </p>
        )}
        <p className="text-[13px] text-muted-foreground">
          {formatLimit(ai.limits.perDayUsd)}/day · {formatLimit(ai.limits.perMonthUsd)}/month
        </p>
        {confirming && (
          <>
            <p className="mt-1 text-[13px] text-danger">
              This removes the AI and its chat. Your provider connection stays.
            </p>
            {actionError !== '' && <FieldError>{actionError}</FieldError>}
          </>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
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
              title={`Open chat with ${ai.name}`}
              onClick={onOpenChat}
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <MessageSquare className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Edit ${ai.name}`}
              title={`Edit ${ai.name}`}
              onClick={onEdit}
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Pencil className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Delete ${ai.name}`}
              title={`Delete ${ai.name}`}
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
