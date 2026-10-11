import { useState } from 'react';
import { useNavigate } from 'react-router';
import { StateMessage } from '@/components/ui/state-message';
import type { DirectoryEntry, HandleProfile } from '@/lib/api';
import { useGroupSearch, usePeopleSearch } from '@/lib/usePeopleSearch';
import { Avatar } from './Avatar';
import { ContactProfileRow } from './ContactProfileRow';

// The People and Public-groups sections above the chat-name and message
// results (3+ characters, after one leading `@`).
export function PeopleSearchResult({ query }: { query: string }) {
  const { state, updateProfile } = usePeopleSearch(query);
  const groups = useGroupSearch(query);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const hadAt = query.trim().startsWith('@');
  const groupEntries = groups.status === 'results' ? groups.entries : [];
  // An empty result shows nothing without `@`, the muted "no one" line with it.
  const showPeople =
    state.status === 'loading' ||
    state.status === 'rate_limited' ||
    state.status === 'error' ||
    (state.status === 'results' && (state.entries.length > 0 || hadAt));

  if (!showPeople && groupEntries.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-0.5 px-2">
      {showPeople && (
        <div className="flex flex-col gap-0.5">
          <p className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">People</p>
          {state.status === 'loading' && (
            <div className="px-[10px] pb-2">
              <StateMessage kind="loading" size="inline" title="Searching…" />
            </div>
          )}
          {state.status === 'results' && state.entries.length === 0 && (
            <p className="px-[10px] pb-2 text-[13px] text-muted-foreground">
              No one with that username.
            </p>
          )}
          {state.status === 'rate_limited' && (
            <div className="px-[10px] pb-2">
              <StateMessage
                kind="error"
                size="inline"
                title="Too many searches, try again in a few minutes."
              />
            </div>
          )}
          {state.status === 'error' && (
            <div className="px-[10px] pb-2">
              <StateMessage kind="error" size="inline" title="Could not search. Try again." />
            </div>
          )}
          {state.status === 'results' &&
            state.entries.map((entry) => (
              <PersonRow
                key={entry.userId}
                entry={entry}
                expanded={expandedId === entry.userId}
                onToggle={() =>
                  setExpandedId((current) => (current === entry.userId ? null : entry.userId))
                }
                onRelationChange={updateProfile}
              />
            ))}
        </div>
      )}
      {groupEntries.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">
            Public groups
          </p>
          {groupEntries.map((entry) => (
            <GroupRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

// A compact chat-list-style person row (no border card); a click toggles the
// shared profile card in place.
function PersonRow({
  entry,
  expanded,
  onToggle,
  onRelationChange,
}: {
  entry: HandleProfile;
  expanded: boolean;
  onToggle: () => void;
  onRelationChange: (profile: HandleProfile) => void;
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 rounded-[12px] px-[10px] py-2 text-left transition-colors hover:bg-surface-raised"
      >
        <Avatar
          id={entry.userId}
          name={entry.name}
          avatarUrl={entry.image ?? undefined}
          size={40}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] leading-5 font-semibold text-foreground">
            {entry.name}
          </span>
          <span className="block truncate text-[13px] text-muted-foreground">@{entry.handle}</span>
        </span>
      </button>
      {expanded && (
        <div className="px-[10px] pb-2">
          <ContactProfileRow profile={entry} onRelationChange={onRelationChange} />
        </div>
      )}
    </div>
  );
}

// One compact public-group row; a click opens its `/@handle` card.
function GroupRow({ entry }: { entry: DirectoryEntry }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/@${entry.handle}`)}
      className="flex w-full items-center gap-3 rounded-[12px] px-[10px] py-2 text-left transition-colors hover:bg-surface-raised"
    >
      <Avatar id={entry.id} name={entry.title} avatarUrl={entry.avatarUrl} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] leading-5 font-semibold text-foreground">
          {entry.title}
        </span>
        <span className="block truncate text-[13px] text-muted-foreground">
          @{entry.handle} · {entry.memberCount} members
        </span>
      </span>
    </button>
  );
}
