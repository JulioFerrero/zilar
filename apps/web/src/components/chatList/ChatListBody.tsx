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
  onOpenNewTopic: (groupId: string) => void;
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
  return (
    <nav
      aria-label="Chats"
      className={cn(
        'scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto',
        isWide ? 'gap-0.5 px-2' : 'gap-0',
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
          {/* People hits come first: `@handle` shows one row for that
              person, above the chat-name matches and the message hits. */}
          {search.trim().startsWith('@') && <PeopleSearchResult query={search} />}
          {chats.length === 0 && archived.length === 0 ? (
            <EmptyState variant="no-chats" onInvite={onInvite} onExplore={onExplore} />
          ) : (
            <>
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
                      avatarUrl={group.avatarUrl}
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
              </TopicKeyboardNav>
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
            </>
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
