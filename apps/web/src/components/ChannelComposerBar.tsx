import type { ChatSummary } from '@zilar/chat-core';
import { useState } from 'react';
import { Composer } from './Composer';
import type { ReplyRef } from '@zilar/chat-core';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';
import { Button } from '@/components/ui/button';

/**
 * The channel feed's bottom bar (T-0124). Admins (owner/admin) see the normal
 * composer — they post. Subscribers see a recessed bar instead:
 * "Only admins can post here" with a Mute / Unmute button (the T-0113 chat
 * pref on the feed row). Posting itself is enforced by the moderated room,
 * not by this bar: a subscriber's send would be refused by ejabberd.
 */
export function ChannelComposerBar({
  chat,
  replyTo,
  onCancelReply,
}: {
  chat: ChatSummary;
  replyTo?: ReplyRef;
  onCancelReply?: () => void;
}) {
  const store = useChatStore();
  const storeApi = useChatStoreApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The role rides the chat row (`myRole`) for channels; the group detail
  // backs it up once loaded. Unknown = subscriber (read-only) until proven
  // otherwise — the safe default.
  const info = store.groupInfo(chat.id);
  const role =
    chat.myRole ?? info?.members.find((member) => member.userId === store.currentUserId)?.role;
  const canPost = role === 'owner' || role === 'admin';

  if (canPost) {
    return (
      <Composer chatId={chat.id} replyTo={replyTo} onCancelReply={onCancelReply ?? (() => {})} />
    );
  }

  const toggleMute = async (): Promise<void> => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Muted = mute forever; unmuted = clear. The T-0113 durations live in
      // the chat menu; this bar is the quick toggle.
      await storeApi.getState().setMuted(chat.id, chat.muted ? null : 'forever');
    } catch {
      setError('Could not change the mute. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat-background relative shrink-0 px-3 pt-2 pb-3 wide:px-8 wide:pt-3 wide:pb-5">
      <div className="flex items-center gap-3 rounded-[14px] bg-surface-raised px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-[14px] text-muted-foreground">
          Only admins can post here
        </p>
        <Button
          type="button"
          variant="ghost"
          className="shrink-0"
          disabled={busy}
          onClick={() => void toggleMute()}
        >
          {chat.muted ? 'Unmute' : 'Mute'}
        </Button>
      </div>
      {error !== '' && (
        <p role="alert" className="mt-1 px-1 text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
