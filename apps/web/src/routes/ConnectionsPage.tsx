import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Effect, Data } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { KeyRound, Link, MoreVertical, Plus, Trash2, Zap } from 'lucide-react';
import { KeyStep } from '@/components/ais/new-ai/KeyStep';
import { ProviderStep } from '@/components/ais/new-ai/ProviderStep';
import { useKeyCheck } from '@/components/ais/new-ai/useKeyCheck';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Button } from '@/components/ui/button';
import { Dialog, DialogStepper } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, MenuItem } from '@/components/ui/menu';
import { StateMessage } from '@/components/ui/state-message';
import { SecretInput } from '@/components/ui/text-input';
import { useToast } from '@/components/ui/toast';
import {
  deleteConnection,
  listConnections,
  replaceConnectionKey,
  testConnection as testConnectionApi,
  type Connection,
  type ConnectionTestResult,
} from '@/lib/api';
import { apiFailureText } from '@/components/panels/groupPanelOps';
import {
  fromApi,
  type ApiFailure,
  failureOf,
  isWaiting,
  shownFailure,
  webUseText,
} from '@zilar/client-core';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { cn } from '@/lib/utils';
import { providerLabel } from '@zilar/chat-core';
import { WEB_SEARCH_PROVIDER_IDS } from '@zilar/api-contract';

const WEB_SEARCH_IDS: readonly string[] = WEB_SEARCH_PROVIDER_IDS;

export function ConnectionsPage() {
  const navigate = useNavigate();
  const [list, refresh] = useQuery(() => fromApi(() => listConnections()), []);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const connections = AsyncResult.isSuccess(list) ? list.value : undefined;
  const loadError = shownFailure(list);
  const visible = (connections ?? []).filter((connection) => !removedIds.has(connection.id));
  const models = visible.filter((connection) => !WEB_SEARCH_IDS.includes(connection.provider));
  const webSearch = visible.filter((connection) => WEB_SEARCH_IDS.includes(connection.provider));

  const markRemoved = (id: string): void => {
    setRemovedIds((ids) => new Set(ids).add(id));
    setConfirmingId(null);
  };

  const renderRow = (connection: Connection) => (
    <ConnectionRow
      key={connection.id}
      connection={connection}
      all={visible}
      confirming={confirmingId === connection.id}
      onAskRemove={() => setConfirmingId(connection.id)}
      onCancelRemove={() => setConfirmingId(null)}
      onRemoved={markRemoved}
    />
  );

  return (
    <SettingsShell
      title="Connections"
      onBack={() => navigate('/settings')}
      action={
        <Button type="button" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden="true" />
          Add key
        </Button>
      }
    >
      <div className={SETTINGS_COLUMN}>
        {loadError === undefined && connections === undefined && (
          <StateMessage kind="loading" title="Loading…" />
        )}

        {loadError !== undefined && (
          <StateMessage
            kind="error"
            title={apiFailureText(loadError, 'Could not load connections')}
            action={{ label: 'Retry', onClick: () => refresh() }}
          />
        )}

        {connections !== undefined && visible.length === 0 && !adding && (
          <StateMessage
            kind="empty"
            icon={Link}
            title="No keys yet"
            action={{ label: 'Add key', onClick: () => setAdding(true) }}
          />
        )}

        {connections !== undefined && visible.length > 0 && (
          <div className="flex flex-col gap-6">
            {models.length > 0 && (
              <section className="flex flex-col">
                <div className="flex items-baseline gap-2 px-1 pb-2">
                  <h2 className="text-[13px] font-medium">Models</h2>
                </div>
                <ul
                  aria-label="Models"
                  className="overflow-hidden rounded-xl border border-border bg-surface"
                >
                  {models.map(renderRow)}
                </ul>
              </section>
            )}

            {webSearch.length > 0 && (
              <section className="flex flex-col">
                <div className="flex items-baseline gap-2 px-1 pb-2">
                  <h2 className="text-[13px] font-medium">Web search</h2>
                  <span className="text-[13px] text-subtle-foreground">
                    for AIs whose model has none
                  </span>
                </div>
                <ul
                  aria-label="Web search"
                  className="overflow-hidden rounded-xl border border-border bg-surface"
                >
                  {webSearch.map(renderRow)}
                </ul>
              </section>
            )}
          </div>
        )}

        {adding && (
          <AddKeyDialog
            onClose={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              refresh();
            }}
          />
        )}
      </div>
    </SettingsShell>
  );
}

function AddKeyDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const keys = useKeyCheck();
  const [step, setStep] = useState(0);

  const close = (): void => {
    keys.abandon();
    onClose();
  };

  const primary = (): void => {
    if (step === 0) {
      if (!keys.providerReady) return;
      setStep(1);
      return;
    }
    if (keys.keyVerified) {
      keys.claim();
      onSaved();
      return;
    }
    keys.continueKey();
  };

  return (
    <Dialog
      open
      onClose={close}
      title="Add key"
      size="lg"
      stepper={
        <DialogStepper
          steps={[{ label: 'Provider', value: keys.providerText }, { label: 'Key' }]}
          current={step}
          onStep={setStep}
        />
      }
      onSubmit={(event) => {
        event.preventDefault();
        primary();
      }}
      footer={
        <>
          {step > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="key-icon mr-auto text-foreground"
              disabled={keys.checkingKey}
              onClick={() => setStep(0)}
            >
              Back
            </Button>
          )}
          <Button
            type="submit"
            size="lg"
            disabled={
              step === 0
                ? !keys.providerReady
                : keys.checkingKey || (!keys.keyVerified && keys.key.trim() === '')
            }
          >
            {step === 0 ? 'Continue' : keys.keyVerified ? 'Save' : 'Continue'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {step === 0 && <ProviderStep keys={keys} withWebSearch />}
        {step === 1 && <KeyStep keys={keys} />}
      </div>
    </Dialog>
  );
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

type TestOutcome = { readonly ok: boolean; readonly message?: string };

function testOutcome(
  state: AsyncResult.AsyncResult<ConnectionTestResult, ApiFailure>,
): TestOutcome | undefined {
  const failure = failureOf(state);
  if (failure !== undefined) {
    return { ok: false, message: apiFailureText(failure, 'Could not test the key') };
  }
  if (!AsyncResult.isSuccess(state)) {
    return undefined;
  }
  return state.value.ok
    ? { ok: true }
    : { ok: false, message: state.value.message ?? 'The key was rejected' };
}

class KeyMissing extends Data.TaggedError('KeyMissing') {}

type FormError = KeyMissing | ApiFailure;

function ReplaceKeyForm({
  connectionId,
  onCancel,
  onSaved,
}: {
  connectionId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState('');
  const [state, save] = useAction((draftKey: string): Effect.Effect<void, FormError> => {
    const trimmedKey = draftKey.trim();
    if (trimmedKey === '') {
      return Effect.fail(new KeyMissing());
    }
    return fromApi(() => replaceConnectionKey(connectionId, trimmedKey)).pipe(
      Effect.asVoid,
      Effect.tap(() => Effect.sync(onSaved)),
    );
  });

  const busy = isWaiting(state);
  const failure = shownFailure(state);
  const error =
    failure === undefined
      ? ''
      : failure._tag === 'KeyMissing'
        ? 'Paste your API key'
        : apiFailureText(failure, 'Could not replace the key');

  return (
    <div className="mt-2 flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">New API key</span>
        <SecretInput
          value={key}
          placeholder="sk-…"
          maxLength={16384}
          autoComplete="off"
          onChange={(event) => setKey(event.target.value)}
        />
      </label>

      {error !== '' && (
        <p role="alert" className="text-[14px] text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" size="default" disabled={busy} onClick={() => save(key)}>
          Save key
        </Button>
        <Button type="button" variant="ghost" size="default" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ConnectionRow({
  connection,
  all,
  confirming,
  onAskRemove,
  onCancelRemove,
  onRemoved,
}: {
  connection: Connection;
  all: readonly Connection[];
  confirming: boolean;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemoved: (id: string) => void;
}) {
  const show = useToast();
  const [testState, runTest, testControls] = useAction((id: string) =>
    fromApi(() => testConnectionApi(id)).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          if (result.ok) show('Key works');
        }),
      ),
    ),
  );
  const [removeState, remove, removeControls] = useAction((id: string) =>
    fromApi(() => deleteConnection(id)).pipe(Effect.tap(() => Effect.sync(() => onRemoved(id)))),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const label = providerLabel(connection.provider);
  const outcome = testOutcome(testState);
  const working = connection.status === 'active' && outcome?.ok !== false;
  const reason = working
    ? undefined
    : connection.status !== 'active'
      ? 'Key revoked'
      : outcome?.message;
  const addedDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(
    new Date(connection.createdAt),
  );
  const useText = webUseText(connection, all);
  const removeFailure = confirming ? shownFailure(removeState) : undefined;

  const askRemove = (): void => {
    removeControls.reset();
    onAskRemove();
  };
  const cancelRemove = (): void => {
    removeControls.reset();
    onCancelRemove();
  };
  const saved = (): void => {
    setReplacing(false);
    testControls.reset();
    show('Key replaced');
  };

  return (
    <li className="flex items-center gap-3 border-b border-divider py-3 pr-2.5 pl-4 last:border-b-0">
      <span
        role="img"
        aria-label={working ? 'Working' : 'Not working'}
        className={cn('size-2 shrink-0 rounded-full', working ? 'bg-online' : 'bg-danger')}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14px] font-semibold">{label}</span>
        <p className="text-[13px] text-muted-foreground">
          {reason !== undefined && <span className="text-danger">{reason}</span>}
          {reason !== undefined && ' · '}
          {connection.label !== null && `${connection.label} · `}
          {connection.baseUrl !== null && `${hostOf(connection.baseUrl)} · `}
          {useText !== undefined && `${useText} · `}
          {addedDate}
        </p>
        {removeFailure !== undefined && (
          <p role="alert" className="text-[13px] text-danger">
            {apiFailureText(removeFailure, 'Could not remove the connection')}
          </p>
        )}
        {replacing && (
          <ReplaceKeyForm
            connectionId={connection.id}
            onCancel={() => setReplacing(false)}
            onSaved={saved}
          />
        )}
      </div>
      {confirming ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => remove(connection.id)}
          >
            Delete
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={cancelRemove}>
            Cancel
          </Button>
        </div>
      ) : (
        <Menu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          label={`${label} key actions`}
          align="end"
          trigger={
            <IconButton aria-label={`${label} key actions`}>
              <MoreVertical className="size-4" aria-hidden="true" />
            </IconButton>
          }
        >
          <MenuItem
            icon={Zap}
            onSelect={() => {
              setMenuOpen(false);
              runTest(connection.id);
            }}
          >
            Test key
          </MenuItem>
          <MenuItem
            icon={KeyRound}
            onSelect={() => {
              setMenuOpen(false);
              setReplacing(true);
            }}
          >
            Replace key
          </MenuItem>
          <MenuItem
            icon={Trash2}
            destructive
            onSelect={() => {
              setMenuOpen(false);
              askRemove();
            }}
          >
            Delete
          </MenuItem>
        </Menu>
      )}
    </li>
  );
}
