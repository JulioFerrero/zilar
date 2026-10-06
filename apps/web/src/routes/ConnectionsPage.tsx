import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Link, Trash2, X, Zap } from 'lucide-react';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { SecretInput, TextInput } from '@/components/ui/text-input';
import {
  type Connection,
  type ConnectionTestResult,
  createConnection,
  deleteConnection,
  listConnections,
  testConnection as testConnectionApi,
} from '@/lib/api';

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google Gemini' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'xai', label: 'xAI' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'github', label: 'GitHub' },
] as const;

function providerLabel(id: string): string {
  return PROVIDERS.find((provider) => provider.id === id)?.label ?? id;
}

export function ConnectionsPage() {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message?: string }>>(
    {},
  );

  const reload = async () => {
    try {
      const list = await listConnections();
      setConnections(list);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Could not load connections');
    }
  };

  useEffect(() => {
    let active = true;
    listConnections()
      .then((list) => {
        if (active) {
          setConnections(list);
          setStatus('ready');
        }
      })
      .catch((error) => {
        if (active) {
          setStatus('error');
          setErrorMessage(error instanceof Error ? error.message : 'Could not load connections');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const addConnection = async (input: { provider: string; key: string; label?: string }) => {
    await createConnection(input);
    setShowForm(false);
    await reload();
  };

  const testConnection = async (id: string) => {
    setTestingId(id);
    try {
      const result: ConnectionTestResult = await testConnectionApi(id);
      setTestResults((previous) => ({
        ...previous,
        [id]: result.ok
          ? { ok: true }
          : { ok: false, message: result.message ?? 'The key was rejected' },
      }));
    } catch (error) {
      setTestResults((previous) => ({
        ...previous,
        [id]: {
          ok: false,
          message: error instanceof Error ? error.message : 'Could not test the key',
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const confirmRemove = async (id: string) => {
    setRemoveError('');
    try {
      await deleteConnection(id);
      setConnections((previous) => previous.filter((connection) => connection.id !== id));
      setConfirmingId(null);
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : 'Could not remove the connection');
    }
  };

  const cancelRemove = () => {
    setConfirmingId(null);
    setRemoveError('');
  };

  return (
    <SettingsShell
      title="Connections"
      subtitle="Connect a provider account to use its models. API keys only for now."
      onBack={() => navigate('/')}
    >
      <div className={SETTINGS_COLUMN}>
        {status === 'loading' && <StateMessage kind="loading" title="Loading…" />}

        {status === 'error' && (
          <StateMessage
            kind="error"
            title={errorMessage}
            action={{
              label: 'Retry',
              onClick: () => {
                setStatus('loading');
                void reload();
              },
            }}
          />
        )}

        {status === 'ready' && connections.length === 0 && !showForm && (
          <StateMessage
            kind="empty"
            icon={Link}
            title="No provider connections yet"
            action={{ label: 'Add a connection', onClick: () => setShowForm(true) }}
          />
        )}

        {status === 'ready' && (connections.length > 0 || showForm) && (
          <div className="flex flex-col gap-4">
            {connections.length > 0 && (
              <section aria-label="Connections" className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-[16px] font-semibold">Connections</h2>
                  {!showForm && (
                    <Button type="button" size="default" onClick={() => setShowForm(true)}>
                      Add a connection
                    </Button>
                  )}
                </div>
                <ul className="flex flex-col gap-2">
                  {connections.map((connection) => (
                    <li
                      key={connection.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1 basis-40">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-medium">
                            {providerLabel(connection.provider)}
                          </span>
                          <span className="rounded-full bg-badge-muted px-2 py-0.5 text-[11px] text-foreground">
                            {connection.status}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">
                          {connection.label !== null ? `${connection.label} · Added ` : 'Added '}
                          {new Intl.DateTimeFormat('en', {
                            month: 'short',
                            day: 'numeric',
                          }).format(new Date(connection.createdAt))}
                        </p>
                        {testResults[connection.id] !== undefined && (
                          <p
                            className={
                              testResults[connection.id]!.ok
                                ? 'text-[13px] text-online'
                                : 'text-[13px] text-danger'
                            }
                          >
                            {testResults[connection.id]!.ok
                              ? 'Key works'
                              : testResults[connection.id]!.message}
                          </p>
                        )}
                        {confirmingId === connection.id && removeError !== '' && (
                          <p role="alert" className="text-[13px] text-danger">
                            {removeError}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                        {confirmingId === connection.id ? (
                          <>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => void confirmRemove(connection.id)}
                            >
                              Remove
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={cancelRemove}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={testingId === connection.id}
                              aria-label={`Test ${providerLabel(connection.provider)} key`}
                              title={`Test ${providerLabel(connection.provider)} key`}
                              onClick={() => void testConnection(connection.id)}
                              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                            >
                              <Zap className="size-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Remove ${providerLabel(connection.provider)} connection`}
                              title={`Remove ${providerLabel(connection.provider)} connection`}
                              onClick={() => {
                                setConfirmingId(connection.id);
                                setRemoveError('');
                              }}
                              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {showForm && (
              <AddConnectionForm
                onCancel={() => setShowForm(false)}
                onSave={(input) => addConnection(input)}
              />
            )}
          </div>
        )}
      </div>
    </SettingsShell>
  );
}

function AddConnectionForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (input: { provider: string; key: string; label?: string }) => Promise<void>;
}) {
  const [provider, setProvider] = useState<string>(PROVIDERS[0].id);
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (key.trim() === '') {
      setError('Paste your API key');
      return;
    }
    setBusy(true);
    try {
      await onSave({
        provider,
        key: key.trim(),
        ...(label.trim() === '' ? {} : { label: label.trim() }),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the connection');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">New connection</h2>
        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={onCancel}
          className="rounded-full p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[14px] font-medium">Provider</span>
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {PROVIDERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[14px] font-medium">API key</span>
          <SecretInput
            value={key}
            placeholder="sk-…"
            maxLength={16384}
            autoComplete="off"
            onChange={(event) => setKey(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[14px] font-medium">Label (optional)</span>
          <TextInput
            value={label}
            placeholder="Work project"
            maxLength={256}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>

        {error !== '' && (
          <p role="alert" className="text-[14px] text-danger">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button type="button" size="lg" disabled={busy} onClick={() => void submit()}>
            Save
          </Button>
          <Button type="button" variant="ghost" size="lg" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
