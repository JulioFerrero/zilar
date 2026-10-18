import {
  NO_PERSON_MESSAGE,
  PEOPLE_LOOKUP_ERROR_MESSAGE,
  PEOPLE_RATE_LIMITED_MESSAGE,
  peopleHandleFor,
  usePeopleHandleSearch,
} from '@zilar/client-core';
import { Link, useNavigate } from 'react-router';
import { StateMessage } from '@/components/ui/state-message';
import { lookupByHandle, type DirectoryEntry, type HandleProfile } from '@/lib/api';
import { useGroupSearch, usePeopleSearch } from '@/lib/usePeopleSearch';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { EntityAvatar } from './EntityAvatar';

// An `@handle` query is an exact lookup; any other 3+ character query (after one leading `@`) is a prefix search.
export function PeopleSearchResult({ query }: { query: string }) {
  const groups = useGroupSearch(query);
  const groupEntries = groups.status === 'results' ? groups.entries : [];

  return (
    <div className="flex flex-col gap-0.5 px-2">
      {peopleHandleFor(query) === null ? (
        <PrefixPeople query={query} />
      ) : (
        <HandlePeople query={query} />
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

function PrefixPeople({ query }: { query: string }) {
  const { state } = usePeopleSearch(query);

  const show =
    state.status === 'loading' ||
    state.status === 'rate_limited' ||
    state.status === 'error' ||
    state.status === 'results';
  if (!show) {
    return null;
  }

  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">People</p>
      {state.status === 'loading' && (
        <div className="px-[10px] pb-2">
          <StateMessage kind="loading" size="inline" title="Searching…" />
        </div>
      )}
      {state.status === 'results' && state.entries.length === 0 && (
        <p className="px-[10px] pb-2 text-[13px] text-muted-foreground">No people found</p>
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
        state.entries.map((entry) => <PersonRow key={entry.userId} entry={entry} />)}
    </div>
  );
}

function HandlePeople({ query }: { query: string }) {
  const { view } = usePeopleHandleSearch(lookupByHandle, query);

  if (view.status === 'idle') {
    return null;
  }

  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">People</p>
      {view.status === 'looking' && (
        <div className="px-[10px] pb-2">
          <StateMessage kind="loading" size="inline" title="Looking up…" />
        </div>
      )}
      {view.status === 'found' && <PersonRow entry={view.profile} />}
      {view.status === 'missing' && (
        <p className="px-[10px] pb-2 text-[13px] text-muted-foreground">{NO_PERSON_MESSAGE}</p>
      )}
      {view.status === 'rateLimited' && (
        <div className="px-[10px] pb-2">
          <StateMessage kind="error" size="inline" title={PEOPLE_RATE_LIMITED_MESSAGE} />
        </div>
      )}
      {view.status === 'error' && (
        <div className="px-[10px] pb-2">
          <StateMessage kind="error" size="inline" title={PEOPLE_LOOKUP_ERROR_MESSAGE} />
        </div>
      )}
    </div>
  );
}

function PersonRow({ entry }: { entry: HandleProfile }) {
  const contacts = useChatSelector((s) => s.contacts);
  const chats = useChatSelector((s) => s.chats);
  const setSearch = useChatSelector((s) => s.setSearch);
  const storeApi = useChatStoreApi();

  // A contact with no chat row yet gets a refresh; the shell opens the DM when it lands.
  const contact = contacts.find((row) => row.userId === entry.userId);
  const href =
    contact === undefined ? `/@${entry.handle}` : `/c/${encodeURIComponent(contact.jid)}`;

  const open = (): void => {
    if (contact !== undefined && !chats.some((chat) => chat.id === contact.jid)) {
      storeApi.getState().refreshChats();
    }
    setSearch('');
  };

  return (
    <Link
      to={href}
      data-topic-row=""
      onClick={open}
      className="flex w-full items-center gap-3 rounded-[12px] px-[10px] py-2 text-left transition-colors hover:bg-surface-raised"
    >
      <EntityAvatar person={entry} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] leading-5 font-semibold text-foreground">
          {entry.name}
        </span>
        <span className="block truncate text-[13px] text-muted-foreground">@{entry.handle}</span>
      </span>
    </Link>
  );
}

function GroupRow({ entry }: { entry: DirectoryEntry }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/@${entry.handle}`)}
      className="flex w-full items-center gap-3 rounded-[12px] px-[10px] py-2 text-left transition-colors hover:bg-surface-raised"
    >
      <EntityAvatar chat={entry} size={40} />
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
