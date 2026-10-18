import { Effect } from 'effect';
import { Brain, UserMinus } from 'lucide-react';
import { useState } from 'react';
import type { ApiFailure } from '@/lib/effect/errors';
import type { TopicAi } from '@/lib/api';
import { AiBadge } from '../AiBadge';
import { EntityAvatar } from '../EntityAvatar';
import { PersonLink } from '../personLink';
import { Menu, MenuItem } from '../ui/menu';
import { StateMessage } from '../ui/state-message';
import { TopicOptionsKey, useRemoveAi } from './TopicActionButtons';
import { LoadFailed, RefreshFailed } from './TopicListNotices';

export type AisState = {
  status: 'loading' | 'ready' | 'error';
  ais: TopicAi[];
  message: string;
};

export function TopicAisSection({
  state,
  pictureOf,
  ownerLabelOf,
  canRemove,
  onRetry,
  onOpenMemory,
  removeAi,
  onError,
}: {
  state: AisState;
  pictureOf: (aiId: string) => string | undefined;
  ownerLabelOf: (aiId: string) => string | undefined;
  canRemove: (aiId: string) => boolean;
  onRetry: () => void;
  onOpenMemory: (ai: { id: string; name: string }) => void;
  removeAi: (aiId: string) => Effect.Effect<void, ApiFailure>;
  onError: (message: string) => void;
}) {
  return (
    <section aria-label="AIs" className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-0.5 text-[12px] font-semibold text-muted-foreground">
        <span>AIs</span>
        {state.status === 'ready' && (
          <span className="font-mono font-normal">{state.ais.length}</span>
        )}
      </div>
      {state.status === 'loading' && <StateMessage kind="loading" size="inline" title="Loading…" />}
      {state.status === 'error' && <LoadFailed message={state.message} onRetry={onRetry} />}
      {state.status === 'ready' && state.ais.length === 0 && state.message === '' && (
        <p className="px-2 text-[13px] text-muted-foreground">No AIs in this topic yet.</p>
      )}
      {state.status === 'ready' && state.message !== '' && (
        <RefreshFailed message={state.message} onRetry={onRetry} />
      )}
      {state.status === 'ready' && state.ais.length > 0 && (
        <div className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface">
          {state.ais.map((ai) => (
            <AiRow
              key={ai.id}
              ai={ai}
              picture={pictureOf(ai.id)}
              ownerLabel={ownerLabelOf(ai.id)}
              canRemove={canRemove(ai.id)}
              onOpenMemory={onOpenMemory}
              removeAi={removeAi}
              onError={onError}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AiRow({
  ai,
  picture,
  ownerLabel,
  canRemove,
  onOpenMemory,
  removeAi,
  onError,
}: {
  ai: TopicAi;
  picture: string | undefined;
  ownerLabel: string | undefined;
  canRemove: boolean;
  onOpenMemory: (ai: { id: string; name: string }) => void;
  removeAi: (aiId: string) => Effect.Effect<void, ApiFailure>;
  onError: (message: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { removing, runRemove } = useRemoveAi({ remove: removeAi, onError });
  const person = (
    <>
      <EntityAvatar person={{ id: ai.id, name: ai.name, avatarUrl: picture }} size={28} ai />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate text-[14px]">{ai.name}</span>
        <AiBadge />
      </span>
    </>
  );
  return (
    <div className="flex min-h-[44px] items-center gap-2.5 pl-2.5 pr-2">
      {ai.jid === undefined ? (
        person
      ) : (
        <PersonLink
          target={{ jid: ai.jid }}
          name={ai.name}
          className="flex min-w-0 flex-1 items-center gap-2.5"
        >
          {person}
        </PersonLink>
      )}
      {ownerLabel !== undefined && (
        <span className="shrink-0 text-[12px] text-muted-foreground">{ownerLabel}</span>
      )}
      <Menu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        label={`${ai.name} options`}
        align="end"
        trigger={<TopicOptionsKey subject={ai.name} disabled={removing} />}
      >
        <MenuItem
          icon={Brain}
          onSelect={() => {
            setMenuOpen(false);
            onOpenMemory({ id: ai.id, name: ai.name });
          }}
        >
          What {ai.name} remembers
        </MenuItem>
        {canRemove && (
          <MenuItem
            icon={UserMinus}
            destructive
            disabled={removing}
            onSelect={() => {
              setMenuOpen(false);
              runRemove(ai.id);
            }}
          >
            Remove from topic
          </MenuItem>
        )}
      </Menu>
    </div>
  );
}
