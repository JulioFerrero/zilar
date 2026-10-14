import { Archive, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatStoreState } from '@/store/store';
import { ChatListItem } from '../ChatListItem';
import { EmptyState } from '../EmptyState';
import { GroupHeaderRow } from '../TopicRow';
import { MessageSearchResults } from '../MessageSearchResults';
import { PeopleSearchResult } from '../PeopleSearchResult';
import { ChatListSkeleton } from '../Skeleton';
import { TopicKeyboardNav } from '../TopicKeyboardNav';
import { Button } from '../ui/button';
import { StateMessage } from '../ui/state-message';
import { normalizePeopleQuery, PEOPLE_SEARCH_MIN_LENGTH } from '@/lib/usePeopleSearch';
import { ContactRequestsRow } from './ContactRequestsRow';
import type { ChatRows } from './rowsSelector';

export interface ChatListBodyProps {
  rows: ChatRows;
  chatsState: ChatStoreState['chatsState'];
  hasAnyChats: boolean;
  retrying: boolean;
  retryChats: () => void;
  search: string;
  searchChat: string | undefined;
  activeChatId: string | undefined;
  isWide: boolean;
  collapsed: Set<string>;
  onToggleCollapse: (groupId: string) => void;
  archivedOpen: Set<string>;
  onToggleArchived: (groupId: string) => void;
  showArchived: boolean;
  onToggleShowArchived: () => void;
  onInvite: () => void;
  onExplore: () => void;
  onOpenNewTopic: (chatId: string) => void;
}

export function ChatListBody({
  rows,
  chatsState,
  hasAnyChats,
  retrying,
  retryChats,
  search,
  searchChat,
  activeChatId,
  isWide,
  collapsed,
  onToggleCollapse,
  archivedOpen,
  onToggleArchived,
  showArchived,
  onToggleShowArchived,
  onInvite,
  onExplore,
  onOpenNewTopic,
}: ChatListBodyProps) {
  const { chats, groups, archived } = rows;
  // People and public-group hits show for any query of 3+ characters once one
  // leading `@` is stripped, not only for `@`-queries.
  const showPeopleSearch = normalizePeopleQuery(search).length >= PEOPLE_SEARCH_MIN_LENGTH;
  return (
    <nav
      aria-label="Chats"
      className={cn(
        'scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto',
        isWide ? 'gap-0.5 px-2' : 'gap-0 pb-20',
      )}
    >
      {chatsState === 'loading' && !hasAnyChats ? (
        <ChatListSkeleton />
      ) : chatsState === 'error' && !hasAnyChats ? (
        <div className="flex h-full flex-col items-center justify-center p-8">
          <StateMessage
            kind="error"
            title="Couldn't load chats"
            action={{ label: 'Retry', onClick: retryChats }}
          />
        </div>
      ) : (
        <>
          {(chatsState === 'error' || retrying) && (
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
              <p className="text-[13px] text-muted-foreground">
                {retrying ? 'Retrying…' : "Couldn't load chats"}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-full"
                disabled={retrying}
                aria-busy={retrying || undefined}
                onClick={retryChats}
              >
                {retrying && (
                  <Loader2
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                )}
                {retrying ? 'Retrying…' : 'Retry'}
              </Button>
            </div>
          )}
          {/* WUX-19: pending incoming contact requests show as a row at the
              top of the list, above the people hits and chat rows. Hidden
              while a query is active, as Telegram and the mobile app's search
              results do: the search view is a list of hits, not the folder. */}
          {search.trim() === '' && <ContactRequestsRow isWide={isWide} />}
          {/* People hits come first: 3+ characters (after stripping `@`) show
              matching people and public groups, above the chat-name matches
              and the message hits. */}
          {showPeopleSearch && <PeopleSearchResult query={search} />}
          {chats.length === 0 && archived.length === 0 ? (
            search.trim() === '' ? (
              <EmptyState variant="no-chats" onInvite={onInvite} onExplore={onExplore} />
            ) : (
              <p className="px-[10px] py-2 text-[13px] text-muted-foreground">No chats match</p>
            )
          ) : (
            // T-1353: `TopicKeyboardNav` grows with `flex-1` (its own class).
            // Inside this scroll container a `flex-1` item has a zero basis, so
            // once the message hits below are taller than the list it collapsed
            // to nothing and its rows painted over the `Messages` section. A
            // plain block wrapper keeps the rows at their natural height, and
            // the whole list scrolls instead.
            <div className="shrink-0">
              <TopicKeyboardNav>
                {groups.map((group) =>
                  group.groupId === undefined ? (
                    <ChatListItem
                      key={group.key}
                      chat={group.topics[0]!}
                      selected={group.topics[0]!.id === activeChatId}
                      isWide={isWide}
                    />
                  ) : (
                    <GroupHeaderRow
                      key={group.key}
                      groupTitle={group.title}
                      groupId={group.groupId}
                      chat={
                        group.topics.find((topic) => topic.topic?.isGeneral === true) ??
                        group.topics[0]!
                      }
                      topics={group.topics}
                      selectedId={activeChatId}
                      collapsed={collapsed.has(group.groupId)}
                      onToggleCollapse={onToggleCollapse}
                      archivedOpen={archivedOpen.has(group.groupId)}
                      onToggleArchived={onToggleArchived}
                      isWide={isWide}
                      onOpenNewTopic={onOpenNewTopic}
                    />
                  ),
                )}
                {/* Per-user archived chats (T-0113): topics hide inside their
                    group's own Archived toggle instead; this row covers DMs,
                    AI chats and legacy groups. */}
                {archived.length > 0 && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-expanded={showArchived}
                      onClick={onToggleShowArchived}
                      className={cn(
                        'w-full justify-start gap-2 text-[13px] font-normal text-muted-foreground hover:text-foreground',
                        isWide && 'rounded-[12px]',
                      )}
                    >
                      <Archive className="size-4" aria-hidden="true" />
                      <span className="flex-1">Archived ({archived.length})</span>
                    </Button>
                    {showArchived &&
                      archived.map((chat) => (
                        <ChatListItem
                          key={chat.id}
                          chat={chat}
                          selected={chat.id === activeChatId}
                          isWide={isWide}
                        />
                      ))}
                  </>
                )}
              </TopicKeyboardNav>
            </div>
          )}
          {/* Message hits come after the chat-name matches. `searchChat`
              scopes "Search only in this chat" from a chat header. */}
          {search.trim().length >= 2 && (
            <MessageSearchResults
              query={search}
              {...(searchChat === undefined ? {} : { chatFilter: searchChat })}
              onNotFound={() => {}}
            />
          )}
        </>
      )}
    </nav>
  );
}
