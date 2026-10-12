import { Link, useNavigate } from 'react-router';
import { personSeed } from '@zilar/chat-core';
import { StateMessage } from '@/components/ui/state-message';
import type { DirectoryEntry, HandleProfile } from '@/lib/api';
import { useGroupSearch, usePeopleSearch } from '@/lib/usePeopleSearch';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { Avatar } from './Avatar';

// The People and Public-groups sections above the chat-name and message
// results (3+ characters, after one leading `@`).
export function PeopleSearchResult({ query }: { query: string }) {
  const { state } = usePeopleSearch(query);
  const groups = useGroupSearch(query);

  const groupEntries = groups.status === 'results' ? groups.entries : [];
  // The section is only mounted for a 3+ character query, so an empty result
  // always shows the "No people found" line, with or without `@`.
  const showPeople =
    state.status === 'loading' ||
    state.status === 'rate_limited' ||
    state.status === 'error' ||
    state.status === 'results';

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

// A compact chat-list-style person row: a click opens the DM with a contact,
// or the person's `/@handle` card, and clears the search. Marked
// `data-topic-row` so the chat-list arrow keys reach it, and a link so Enter
// on a focused row activates it.
function PersonRow({ entry }: { entry: HandleProfile }) {
  const contacts = useChatSelector((s) => s.contacts);
  const chats = useChatSelector((s) => s.chats);
  const setSearch = useChatSelector((s) => s.setSearch);
  const me = useChatSelector((s) => s.me);
  const storeApi = useChatStoreApi();

  // The lookup profile carries no JID; the store's contact does. A contact
  // with no chat row yet (the list has not refreshed since it was added) gets
  // a refresh, and the shell opens the DM once the row lands. T-1209: the
  // ball is seeded by that same bare JID, else by the user id derived the
  // way the mention builder does (the domain from my own JID).
  const contact = contacts.find((row) => row.userId === entry.userId);
  const ownDomain = me?.jid?.slice(me.jid.indexOf('@') + 1);
  const seed =
    contact?.jid ?? (ownDomain === undefined ? entry.userId : personSeed(entry.userId, ownDomain));
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
      <Avatar id={seed} name={entry.name} avatarUrl={entry.image ?? undefined} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] leading-5 font-semibold text-foreground">
          {entry.name}
        </span>
        <span className="block truncate text-[13px] text-muted-foreground">@{entry.handle}</span>
      </span>
    </Link>
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
