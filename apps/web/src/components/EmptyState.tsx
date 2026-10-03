import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type EmptyStateVariant = 'no-chats' | 'no-chat-selected';

export function EmptyState({
  variant,
  onInvite,
  onAddContact,
  onExplore,
}: {
  variant: EmptyStateVariant;
  onInvite?: () => void;
  onAddContact?: () => void;
  // T-0164: reaching the Explore directory from the empty state.
  onExplore?: () => void;
}) {
  if (variant === 'no-chats') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <UserPlus className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-[15px] text-muted-foreground">No chats here yet</p>
        <Button type="button" size="lg" className="rounded-full px-5" onClick={onInvite}>
          Invite a friend
        </Button>
        {onAddContact !== undefined && (
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="rounded-full px-5"
            onClick={onAddContact}
          >
            Add contact
          </Button>
        )}
        {onExplore !== undefined && (
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="rounded-full px-5"
            onClick={onExplore}
          >
            Explore groups
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="chat-background flex h-full items-center justify-center">
      <span className="raised-pill rounded-full px-4 py-2 text-[15px] text-muted-foreground">
        Select a chat to start messaging
      </span>
    </div>
  );
}
