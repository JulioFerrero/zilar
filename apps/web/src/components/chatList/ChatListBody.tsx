import { peopleHandleFor } from '@zilar/client-core';
import { Archive, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatStoreState } from '@/store/store';
import { ChatListItem } from '../ChatListItem';
import { EmptyState } from '../EmptyState';
import { GroupHeaderRow } from './GroupHeaderRow';
import { MessageSearchResults } from '../MessageSearchResults';
import { PeopleSearchResult } from '../PeopleSearchResult';
import { ChatListSkeleton } from '../Skeleton';
import { Button } from '../ui/button';
import { StateMessage } from '../ui/state-message';
import { normalizePeopleQuery, PEOPLE_SEARCH_MIN_LENGTH } from '@/lib/usePeopleSearch';
import { RequestRows as ContactRequestsRow } from './RequestRows';
import type { ChatRows } from './rowsSelector';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

/**
 * Arrow keys move focus between `data-topic-row` rows inside the chat list;
 * links elsewhere on the page never take part.
 */
function TopicKeyboardNav({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    // Alt/Ctrl/Meta+arrows belong to the window-level chat switch.
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') {
      return;
    }
    const root = event.currentTarget;
    const list = root.closest('nav[aria-label="Chats"]') ?? root;
    const links = Array.from(list.querySelectorAll<HTMLAnchorElement>('a[data-topic-row]'));
    const current = document.activeElement;
    const index = links.findIndex((link) => link === current);
    if (event.key === 'Enter') {
      if (current instanceof HTMLAnchorElement && links.includes(current)) {
        event.preventDefault();
        navigate(current.getAttribute('href') ?? '/');
      }
      return;
    }
    event.preventDefault();
    if (links.length === 0) {
      return;
    }
    const next =
      index === -1
        ? (links[0] as HTMLAnchorElement)
        : event.key === 'ArrowDown'
          ? (links[(index + 1) % links.length] as HTMLAnchorElement)
          : (links[(index - 1 + links.length) % links.length] as HTMLAnchorElement);
    next.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

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
  // An `@handle` query looks the person up exactly (like the phone); any other
  // query of 3+ characters shows the prefix hits.
  const showPeopleSearch =
    peopleHandleFor(search) !== null ||
    normalizePeopleQuery(search).length >= PEOPLE_SEARCH_MIN_LENGTH;
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
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
              <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-surface-raised py-1 pr-1 pl-3 shadow-sm">
                <p role="status" className="text-[13px] text-muted-foreground">
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
            </div>
          )}
          {search.trim() === '' && <ContactRequestsRow isWide={isWide} />}
          {/* People hits come first: 3+ characters (after stripping `@`) show matching
           * people and public groups, above chat-name matches and message hits.
           */}
          {showPeopleSearch && <PeopleSearchResult query={search} />}
          {chats.length === 0 && archived.length === 0 ? (
            search.trim() === '' ? (
              <EmptyState variant="no-chats" onInvite={onInvite} onExplore={onExplore} />
            ) : (
              <p className="px-[10px] py-2 text-[13px] text-muted-foreground">No chats match</p>
            )
          ) : (
            // `TopicKeyboardNav` grows with `flex-1`. Inside this scroll container a
            // `flex-1` item has a zero basis, so it collapsed to nothing once the message
            // hits below were taller and painted over the `Messages` section. A plain block
            // wrapper keeps the rows at their natural height and the whole list scrolls.
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
