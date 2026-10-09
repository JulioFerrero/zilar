import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { MessageSquare, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { ApiError, deleteAi, listAis, listConnections, type PublicAi } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { AiBadge } from '@/components/AiBadge';
import { Avatar } from '@/components/Avatar';
import { FieldError } from '@/components/ais/AiPageShell';
import { Button } from '@/components/ui/button';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { StateMessage } from '@/components/ui/state-message';
import { providerLabel } from '@/components/ais/ConnectionPicker';
import { describeAiError } from '@/components/ais/errors';
import { formatLimit } from '@/components/ais/limits';
import { NewAiDialog } from '@/components/ais/NewAiDialog';
import { templateLabel } from '@/components/ais/templates';

/** `$2` -> `$2.00`. Server amounts are plain USD numbers. */
function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** The last failure, hidden while a new call runs (the page cleared it at once before). */
function shownFailure<A, E>(state: AsyncResult.AsyncResult<A, E>): E | undefined {
  return isWaiting(state) ? undefined : failureOf(state);
}

/**
 * The words for an api.ts failure, through describeAiError so each server code
 * keeps its wording. A call that never reached the server gets the fallback.
 */
function aiFailureText(failure: ApiFailure, fallback: string): string {
  if (failure.code === 'unknown_error') {
    return fallback;
  }
  return describeAiError(
    new ApiError(failure.status, failure.code, failure.message, failure.detail),
    fallback,
  ).message;
}

export function AisPage() {
  const navigate = useNavigate();

  const [list, reload] = useQuery(() => fromApi(() => listAis()), []);
  const ais = AsyncResult.isSuccess(list) ? list.value : undefined;
  const [providers] = useQuery(() => providerNamesOf(ais ?? []), [ais]);
  const providerNames: Record<string, string> = AsyncResult.isSuccess(providers)
    ? providers.value
    : {};

  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadError = shownFailure(list);
  const visible = (ais ?? []).filter((ai) => !removedIds.has(ai.id));

  const markRemoved = (id: string): void => {
    setRemovedIds((ids) => new Set(ids).add(id));
    setConfirmingId(null);
  };

  return (
    <SettingsShell
      title="My AIs"
      subtitle="Your AIs, their model and their spending limits."
      onBack={() => navigate('/')}
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
            title="You have no AIs yet."
            hint="Create one to give it a chat account and a budget."
            action={{ label: 'Create an AI', onClick: () => setCreating(true) }}
          />
        )}

        {ais !== undefined && visible.length > 0 && (
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
              {visible.map((ai) => (
                <li key={ai.id}>
                  <AiRow
                    ai={ai}
                    providerName={providerNames[ai.providerConnectionId]}
                    confirming={confirmingId === ai.id}
                    onOpenChat={() => navigate(`/c/${encodeURIComponent(ai.jid)}`)}
                    onEdit={() => navigate(`/c/${encodeURIComponent(ai.jid)}?panel=ai`)}
                    onAskDelete={() => setConfirmingId(ai.id)}
                    onCancelDelete={() => setConfirmingId(null)}
                    onDeleted={markRemoved}
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

/**
 * One AI row with its own delete action, so two rows can be removed at once;
 * a second click on the same row waits for the first.
 */
function AiRow({
  ai,
  providerName,
  confirming,
  onOpenChat,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onDeleted,
}: {
  ai: PublicAi;
  providerName: string | undefined;
  confirming: boolean;
  onOpenChat: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDeleted: (id: string) => void;
}) {
  const [deleteState, remove, controls] = useAction((id: string) =>
    fromApi(() => deleteAi(id)).pipe(Effect.tap(() => Effect.sync(() => onDeleted(id)))),
  );
  const deleting = isWaiting(deleteState);
  const failure = shownFailure(deleteState);
  const actionError =
    confirming && failure !== undefined ? aiFailureText(failure, 'Could not delete the AI') : '';

  // Asking again or cancelling clears the last error, as the page did before.
  const askDelete = (): void => {
    controls.reset();
    onAskDelete();
  };
  const cancelDelete = (): void => {
    controls.reset();
    onCancelDelete();
  };

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Avatar id={ai.id} name={ai.name} size={44} ai avatarUrl={ai.avatarUrl} />
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
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => remove(ai.id)}
            >
              Remove
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={deleting}
              onClick={cancelDelete}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Open chat with ${ai.name}`}
              title={`Open chat with ${ai.name}`}
              onClick={onOpenChat}
              className="text-muted-foreground"
            >
              <MessageSquare className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Edit ${ai.name}`}
              title={`Edit ${ai.name}`}
              onClick={onEdit}
              className="text-muted-foreground"
            >
              <Pencil className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Delete ${ai.name}`}
              title={`Delete ${ai.name}`}
              onClick={askDelete}
              className="text-muted-foreground hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
    </div>
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
