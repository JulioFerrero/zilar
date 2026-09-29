import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Eye, EyeOff, Link, Trash2, Zap } from 'lucide-react';
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
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-divider px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Back"
            onClick={() => navigate('/')}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </button>
          <h1 className="text-[20px] leading-7 font-semibold">Connections</h1>
        </div>
        <p className="mt-1 text-[14px] text-muted-foreground">
          Connect a provider account to use its models. API keys only for now.
        </p>
      </header>

      <div className="flex-1 overflow-auto p-4">
        {status === 'loading' && <p className="text-[15px] text-muted-foreground">Loading…</p>}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 text-center">
            <p role="alert" className="text-[15px] text-danger">
              {errorMessage}
            </p>
            <button
              type="button"
              onClick={() => {
                setStatus('loading');
                void reload();
              }}
              className="rounded-full bg-accent px-4 py-2 text-[15px] font-medium text-accent-foreground hover:bg-accent/90"
            >
              Retry
            </button>
          </div>
        )}

        {status === 'ready' && connections.length === 0 && !showForm && (
          <div className="flex flex-col items-center gap-3 text-center">
            <Link className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-[15px] text-muted-foreground">No provider connections yet</p>
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="rounded-full bg-accent px-5 py-2 text-[15px] font-medium text-accent-foreground hover:bg-accent/90"
            >
              Add a connection
            </button>
          </div>
        )}

        {status === 'ready' && (connections.length > 0 || showForm) && (
          <div className="flex flex-col gap-4">
            {connections.length > 0 && (
              <ul className="flex flex-col gap-1">
                {connections.map((connection) => (
                  <li
                    key={connection.id}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-list-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[16px] font-semibold">
                          {providerLabel(connection.provider)}
                        </span>
                        {connection.label !== null && (
                          <span className="text-[13px] text-muted-foreground">
                            {connection.label}
                          </span>
                        )}
                        <span className="rounded-full bg-badge-muted px-2 py-0.5 text-[11px] text-foreground">
                          {connection.status}
                        </span>
                      </div>
                      <p className="text-[13px] text-muted-foreground">
                        Added{' '}
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
                    <div className="flex items-center gap-1">
                      {confirmingId === connection.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void confirmRemove(connection.id)}
                            className="rounded-full bg-danger px-3 py-1.5 text-[14px] font-medium text-white hover:bg-danger/90"
                          >
                            Remove
                          </button>
                          <button
                            type="button"
                            onClick={cancelRemove}
                            className="rounded-full px-3 py-1.5 text-[14px] text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={testingId === connection.id}
                            aria-label={`Test ${providerLabel(connection.provider)} key`}
                            onClick={() => void testConnection(connection.id)}
                            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                          >
                            <Zap className="size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${providerLabel(connection.provider)} connection`}
                            onClick={() => {
                              setConfirmingId(connection.id);
                              setRemoveError('');
                            }}
                            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {showForm ? (
              <AddConnectionForm
                onCancel={() => setShowForm(false)}
                onSave={(input) => addConnection(input)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="flex items-center gap-2 self-start rounded-lg px-3 py-2 text-[15px] text-muted-foreground transition-colors hover:bg-list-hover hover:text-foreground"
              >
                <span className="text-[20px] leading-none">+</span> Add a connection
              </button>
            )}
          </div>
        )}
      </div>
    </div>
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
  const [showKey, setShowKey] = useState(false);
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
    <div className="max-w-md rounded-xl border border-divider bg-background p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">New connection</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onCancel}
          className="rounded-full p-1 text-muted-foreground hover:bg-muted"
        >
          ✕
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
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={key}
              placeholder="sk-…"
              maxLength={16384}
              autoComplete="off"
              onChange={(event) => setKey(event.target.value)}
              className="w-full rounded-lg border border-input bg-background py-2 pr-10 pl-3 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
            />
            <button
              type="button"
              aria-label={showKey ? 'Hide key' : 'Show key'}
              onClick={() => setShowKey((value) => !value)}
              className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[14px] font-medium">Label (optional)</span>
          <input
            value={label}
            placeholder="Work project"
            maxLength={256}
            onChange={(event) => setLabel(event.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        </label>

        {error !== '' && (
          <p role="alert" className="text-[14px] text-danger">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="rounded-full bg-accent px-4 py-2 text-[15px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
          >
            Save
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-[15px] text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
