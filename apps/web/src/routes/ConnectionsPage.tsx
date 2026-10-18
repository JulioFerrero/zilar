import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AsyncResult } from 'effect/reactivity';
import { Link, Plus } from 'lucide-react';
import { AddKeyDialog } from '@/components/connections/AddKeyDialog';
import { ConnectionRow } from '@/components/connections/ConnectionRow';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { listConnections } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { shownFailure } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';

/** The server's words for a failure, or the fixed fallback for a call that never reached the server. */
function messageOf(failure: ApiFailure, fallback: string): string {
  return failure.code === 'unknown_error' ? fallback : failure.message;
}

export function ConnectionsPage() {
  const navigate = useNavigate();
  const [list, refresh] = useQuery(() => fromApi(() => listConnections()), []);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
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
            title={messageOf(loadError, 'Could not load connections')}
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
          <ul
            aria-label="Connections"
            className="overflow-hidden rounded-xl border border-border bg-surface"
          >
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
