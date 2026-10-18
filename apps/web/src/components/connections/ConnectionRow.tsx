import { useState } from 'react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { KeyRound, MoreVertical, Trash2, Zap } from 'lucide-react';
import { providerLabel } from '@zilar/chat-core';
import { ReplaceKeyForm } from '@/components/connections/ReplaceKeyForm';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, MenuItem } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast';
import {
  type Connection,
  type ConnectionTestResult,
  deleteConnection,
  testConnection as testConnectionApi,
} from '@/lib/api';
import { fromApi, type ApiFailure } from '@zilar/client-core';
import { failureOf, shownFailure, useAction } from '@/lib/effect/use-action';
import { cn } from '@/lib/utils';

function messageOf(failure: ApiFailure, fallback: string): string {
  return failure.code === 'unknown_error' ? fallback : failure.message;
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
    return { ok: false, message: messageOf(failure, 'Could not test the key') };
  }
  if (!AsyncResult.isSuccess(state)) {
    return undefined;
  }
  return state.value.ok
    ? { ok: true }
    : { ok: false, message: state.value.message ?? 'The key was rejected' };
}

export function ConnectionRow({
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
          {addedDate}
        </p>
        {removeFailure !== undefined && (
          <p role="alert" className="text-[13px] text-danger">
            {messageOf(removeFailure, 'Could not remove the connection')}
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
