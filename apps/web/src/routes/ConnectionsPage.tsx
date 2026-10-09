import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
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
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';

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

/** The form's own check: the key is pasted before anything is sent. */
class KeyMissing extends Data.TaggedError('KeyMissing') {}

type FormError = KeyMissing | ApiFailure;

/** The last failure, hidden while a new call runs (the page cleared it at once before). */
function shownFailure<A, E>(state: AsyncResult.AsyncResult<A, E>): E | undefined {
  return isWaiting(state) ? undefined : failureOf(state);
}

/** The server's words for a failure, or the fixed fallback for a call that never reached the server. */
function messageOf(failure: ApiFailure, fallback: string): string {
  return failure.code === 'unknown_error' ? fallback : failure.message;
}

export function ConnectionsPage() {
  const navigate = useNavigate();
  const [list, refresh] = useQuery(() => fromApi(() => listConnections()), []);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [showForm, setShowForm] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const connections = AsyncResult.isSuccess(list) ? list.value : undefined;
  const loadError = shownFailure(list);
  const visible = (connections ?? []).filter((connection) => !removedIds.has(connection.id));

  const markRemoved = (id: string): void => {
    setRemovedIds((ids) => new Set(ids).add(id));
    setConfirmingId(null);
  };

  return (
    <SettingsShell
      title="Connections"
      subtitle="Connect a provider account to use its models. API keys only for now."
      onBack={() => navigate('/')}
    >
      <div className={SETTINGS_COLUMN}>
        {loadError === undefined && connections === undefined && (
          <StateMessage kind="loading" title="Loading…" />
        )}

        {loadError !== undefined && (
          <StateMessage
            kind="error"
            title={messageOf(loadError, 'Could not load connections')}
            action={{ label: 'Retry', onClick: () => refresh() }}
          />
        )}

        {connections !== undefined && visible.length === 0 && !showForm && (
          <StateMessage
            kind="empty"
            icon={Link}
            title="No provider connections yet"
            action={{ label: 'Add a connection', onClick: () => setShowForm(true) }}
          />
        )}

        {connections !== undefined && (visible.length > 0 || showForm) && (
          <div className="flex flex-col gap-4">
            {visible.length > 0 && (
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
                  {visible.map((connection) => (
                    <ConnectionRow
                      key={connection.id}
                      connection={connection}
                      confirming={confirmingId === connection.id}
                      onAskRemove={() => setConfirmingId(connection.id)}
                      onCancelRemove={() => setConfirmingId(null)}
                      onRemoved={markRemoved}
                    />
                  ))}
                </ul>
              </section>
            )}

            {showForm && (
              <AddConnectionForm
                onCancel={() => setShowForm(false)}
                onSaved={() => {
                  setShowForm(false);
                  refresh();
                }}
              />
            )}
          </div>
        )}
      </div>
    </SettingsShell>
  );
}

type TestOutcome = { readonly ok: boolean; readonly message?: string };

/** The last test result: a failure or a result, kept while the next test runs (as before). */
function testOutcome(
  state: AsyncResult.AsyncResult<ConnectionTestResult, ApiFailure>,
): TestOutcome | undefined {
  const failure = failureOf(state);
  if (failure !== undefined) {
    return { ok: false, message: messageOf(failure, 'Could not test the key') };
  }
  if (!AsyncResult.isSuccess(state)) {
    return undefined;
  }
  return state.value.ok
    ? { ok: true }
    : { ok: false, message: state.value.message ?? 'The key was rejected' };
}

/**
 * One connection with its own Test and Remove actions, so two rows can run at
 * once; a second click on the same action waits for its first call.
 */
function ConnectionRow({
  connection,
  confirming,
  onAskRemove,
  onCancelRemove,
  onRemoved,
}: {
  connection: Connection;
  confirming: boolean;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemoved: (id: string) => void;
}) {
  const [testState, runTest] = useAction((id: string) => fromApi(() => testConnectionApi(id)));
  const [removeState, remove, removeControls] = useAction((id: string) =>
    fromApi(() => deleteConnection(id)).pipe(Effect.tap(() => Effect.sync(() => onRemoved(id)))),
  );
  const label = providerLabel(connection.provider);
  const outcome = testOutcome(testState);
  const removeFailure = confirming ? shownFailure(removeState) : undefined;

  // Asking again or cancelling clears the last remove error, as the page did before.
  const askRemove = (): void => {
    removeControls.reset();
    onAskRemove();
  };
  const cancelRemove = (): void => {
    removeControls.reset();
    onCancelRemove();
  };

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <div className="min-w-0 flex-1 basis-40">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-medium">{label}</span>
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
        {outcome !== undefined && (
          <p className={outcome.ok ? 'text-[13px] text-online' : 'text-[13px] text-danger'}>
            {outcome.ok ? 'Key works' : outcome.message}
          </p>
        )}
        {removeFailure !== undefined && (
          <p role="alert" className="text-[13px] text-danger">
            {messageOf(removeFailure, 'Could not remove the connection')}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {confirming ? (
          <>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => remove(connection.id)}
            >
              Remove
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={cancelRemove}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={isWaiting(testState)}
              aria-label={`Test ${label} key`}
              title={`Test ${label} key`}
              onClick={() => runTest(connection.id)}
              className="rounded-full text-muted-foreground"
            >
              <Zap className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${label} connection`}
              title={`Remove ${label} connection`}
              onClick={askRemove}
              className="rounded-full text-muted-foreground hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function AddConnectionForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [provider, setProvider] = useState<string>(PROVIDERS[0].id);
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [state, save] = useAction(
    (draft: {
      readonly provider: string;
      readonly key: string;
      readonly label: string;
    }): Effect.Effect<void, FormError> => {
      const trimmedKey = draft.key.trim();
      if (trimmedKey === '') {
        return Effect.fail(new KeyMissing());
      }
      const trimmedLabel = draft.label.trim();
      return fromApi(() =>
        createConnection({
          provider: draft.provider,
          key: trimmedKey,
          ...(trimmedLabel === '' ? {} : { label: trimmedLabel }),
        }),
      ).pipe(
        Effect.asVoid,
        Effect.tap(() => Effect.sync(onSaved)),
      );
    },
  );

  const busy = isWaiting(state);
  const failure = shownFailure(state);
  const error =
    failure === undefined
      ? ''
      : failure._tag === 'KeyMissing'
        ? 'Paste your API key'
        : messageOf(failure, 'Could not save the connection');

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">New connection</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          title="Close"
          onClick={onCancel}
          className="rounded-full text-muted-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
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
          <Button
            type="button"
            size="lg"
            disabled={busy}
            onClick={() => save({ provider, key, label })}
          >
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
