import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type EmptyStateVariant = 'no-chats' | 'no-chat-selected';

export function EmptyState({
  variant,
  onInvite,
}: {
  variant: EmptyStateVariant;
  onInvite?: () => void;
}) {
  if (variant === 'no-chats') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <UserPlus className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-[15px] text-muted-foreground">No chats here yet</p>
        <Button type="button" size="lg" className="rounded-full px-5" onClick={onInvite}>
          Invite a friend
        </Button>
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
