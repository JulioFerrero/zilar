import { Effect } from 'effect';
import { Brain } from 'lucide-react';
import type { ApiFailure } from '@/lib/effect/errors';
import type { TopicAi } from '@/lib/api';
import { AiBadge } from '../AiBadge';
import { EntityAvatar } from '../EntityAvatar';
import { Button } from '../ui/button';
import { StateMessage } from '../ui/state-message';
import { RemoveAiButton } from './TopicActionButtons';
import { LoadFailed, RefreshFailed } from './TopicListNotices';

export type AisState = {
  status: 'loading' | 'ready' | 'error';
  ais: TopicAi[];
  message: string;
};

/**
 * The "AIs in this topic" section: rows with memory and Remove. The add pickers
 * moved to the one "Add people or AIs" dialog (T-1784).
 */
export function TopicAisSection({
  state,
  pictureOf,
  ownerNameOf,
  canRemove,
  onRetry,
  onOpenMemory,
  removeAi,
  onError,
}: {
  state: AisState;
  /** Topic AI rows carry no picture; the group detail knows it. */
  pictureOf: (aiId: string) => string | undefined;
  ownerNameOf: (aiId: string) => string;
  canRemove: (aiId: string) => boolean;
  onRetry: () => void;
  onOpenMemory: (ai: { id: string; name: string }) => void;
  removeAi: (aiId: string) => Effect.Effect<void, ApiFailure>;
  onError: (message: string) => void;
}) {
  return (
    <section aria-label="AIs in this topic" className="flex flex-col gap-1">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">AIs in this topic</h2>
      {state.status === 'loading' && <StateMessage kind="loading" size="inline" title="Loading…" />}
      {state.status === 'error' && <LoadFailed message={state.message} onRetry={onRetry} />}
      {state.status === 'ready' && state.ais.length === 0 && state.message === '' && (
        <p className="px-2 text-[13px] text-muted-foreground">No AIs in this topic yet.</p>
      )}
      {state.status === 'ready' && state.message !== '' && (
        <RefreshFailed message={state.message} onRetry={onRetry} />
      )}
      {state.status === 'ready' &&
        state.ais.map((ai) => (
          <div
            key={ai.id}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
          >
            <EntityAvatar
              person={{ id: ai.id, name: ai.name, avatarUrl: pictureOf(ai.id) }}
              size={32}
              ai
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[14px]">{ai.name}</span>
                <AiBadge />
              </div>
              <p className="truncate text-[12px] text-muted-foreground">
                Added by {ownerNameOf(ai.id)}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`What ${ai.name} remembers`}
              className="shrink-0 text-muted-foreground"
              onClick={() => onOpenMemory({ id: ai.id, name: ai.name })}
            >
              <Brain className="size-4" aria-hidden="true" />
            </Button>
            {canRemove(ai.id) && <RemoveAiButton ai={ai} remove={removeAi} onError={onError} />}
          </div>
        ))}
    </section>
  );
}
