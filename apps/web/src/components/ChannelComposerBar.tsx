import type { ChatSummary } from '@zilar/chat-core';
import { Composer } from './Composer';
import type { ReplyRef } from '@zilar/chat-core';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { Button } from '@/components/ui/button';
import { useMuteToggle } from '@/components/useMuteToggle';

/** Subscribers see a read-only bar; the moderated room enforces posting, not this bar. */
export function ChannelComposerBar({
  chat,
  replyTo,
  onCancelReply,
}: {
  chat: ChatSummary;
  replyTo?: ReplyRef;
  onCancelReply?: () => void;
}) {
  const info = useChatSelector((s) => s.groupInfo(chat.id));
  const currentUserId = useChatSelector((s) => s.currentUserId);
  const { muted, busy, error, toggle } = useMuteToggle(chat);

  // Unknown role means subscriber (read-only) until proven otherwise.
  const role = chat.myRole ?? info?.members.find((member) => member.userId === currentUserId)?.role;
  const canPost = role === 'owner' || role === 'admin';

  if (canPost) {
    return (
      <Composer chatId={chat.id} replyTo={replyTo} onCancelReply={onCancelReply ?? (() => {})} />
    );
  }

  return (
    <div className="pointer-events-none relative px-3 pt-2 pb-3 *:pointer-events-auto wide:px-8 wide:pt-3 wide:pb-5">
      <div className="flex items-center gap-3 rounded-[14px] bg-surface-raised px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-[14px] text-muted-foreground">
          Only admins can post here
        </p>
        <Button type="button" variant="ghost" className="shrink-0" disabled={busy} onClick={toggle}>
          {muted ? 'Unmute' : 'Mute'}
        </Button>
      </div>
      {error !== undefined && (
        <p role="alert" className="mt-1 px-1 text-[12px] text-danger">
          Could not change the mute. Try again.
        </p>
      )}
    </div>
  );
}
