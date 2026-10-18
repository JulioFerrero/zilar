import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Plus, Zap } from 'lucide-react';
import { listAis, listConnections, type PublicAi } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { shownFailure } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { AiHealthRow } from '@/components/ais/AiHealthRow';
import { Button } from '@/components/ui/button';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { StateMessage } from '@/components/ui/state-message';
import { providerLabel } from '@/components/ais/ConnectionPicker';
import { aiFailureText } from '@/components/ais/errors';
import { NewAiDialog } from '@/components/ais/NewAiDialog';

export function AisPage() {
  const navigate = useNavigate();

  const [list, reload] = useQuery(() => fromApi(() => listAis()), []);
  const ais = AsyncResult.isSuccess(list) ? list.value : undefined;
  const [providers] = useQuery(() => providerNamesOf(ais ?? []), [ais]);
  const providerNames: Record<string, string> = AsyncResult.isSuccess(providers)
    ? providers.value
    : {};

  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [creating, setCreating] = useState(false);

  const loadError = shownFailure(list);
  const visible = (ais ?? []).filter((ai) => !removedIds.has(ai.id));

  const markRemoved = (id: string): void => {
    setRemovedIds((ids) => new Set(ids).add(id));
  };

  return (
    <SettingsShell
      title="My AIs"
      action={
        <Button
          type="button"
          size="lg"
          className="rounded-full px-5"
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden="true" />
          New AI
        </Button>
      }
      onBack={() => navigate('/settings')}
    >
      <div className={SETTINGS_COLUMN}>
        {loadError === undefined && ais === undefined && (
          <StateMessage kind="loading" title="Loading…" />
        )}

        {loadError !== undefined && (
          <StateMessage
            kind="error"
            title={aiFailureText(loadError, 'Could not load your AIs')}
            action={{ label: 'Retry', onClick: () => reload() }}
          />
        )}

        {ais !== undefined && visible.length === 0 && (
          <StateMessage
            kind="empty"
            icon={Zap}
            title="No AIs yet"
            hint="Create one to give it a chat account and a budget."
            action={{ label: 'New AI', onClick: () => setCreating(true) }}
          />
        )}

        {ais !== undefined && visible.length > 0 && (
          <ul className="overflow-hidden rounded-xl border border-border bg-surface">
            {visible.map((ai) => (
              <AiHealthRow
                key={ai.id}
                ai={ai}
                providerName={providerNames[ai.providerConnectionId]}
                onOpenChat={() => navigate(`/c/${encodeURIComponent(ai.jid)}`)}
                onEdit={() => navigate(`/c/${encodeURIComponent(ai.jid)}?panel=ai`)}
                onDeleted={markRemoved}
              />
            ))}
          </ul>
        )}
      </div>

      {creating && <NewAiDialog onClose={() => setCreating(false)} />}
    </SettingsShell>
  );
}

/** The provider name is decoration on a row, never a reason to fail the page. */
function providerNamesOf(ais: ReadonlyArray<PublicAi>): Effect.Effect<Record<string, string>> {
  if (ais.length === 0) {
    return Effect.succeed<Record<string, string>>({});
  }
  return fromApi(() => listConnections()).pipe(
    Effect.map((connections) => {
      const map: Record<string, string> = {};
      for (const connection of connections) {
        map[connection.id] = providerLabel(connection.provider);
      }
      return map;
    }),
    Effect.orElseSucceed((): Record<string, string> => ({})),
  );
}
