import { Image as ImageIcon, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from './ui/button';
import { SegmentedControl } from './ui/segmented-control';
import { Sheet } from './ui/sheet';
import type { MediaTab } from '@/lib/api';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { MediaBody } from './media/MediaBody';
import { TABS, type JumpTarget } from './media/mediaModel';

/**
 * The chat media gallery (T-0434): Media / Files / Links / Voice tabs backed by
 * `GET /api/media`. Media items on an untrusted host arrive without a `url`
 * (see the real store), so they render as a file row and never auto-load.
 * Opened from the chat menu for DMs, groups and topics.
 */
export function ChatMediaPanel({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const chat = useChatSelector((s) => s.chats.find((entry) => entry.id === chatId));
  const [tab, setTab] = useState<MediaTab>('media');
  const [jumpFailed, setJumpFailed] = useState(false);

  const jump: JumpTarget = {
    chatId,
    onStart: () => setJumpFailed(false),
    onOpened: onClose,
    onFailed: () => setJumpFailed(true),
  };

  const selectTab = (value: MediaTab): void => {
    if (value === tab) {
      return;
    }
    setJumpFailed(false);
    setTab(value);
  };

  const label = chat?.title ?? 'this chat';

  return (
    <Sheet open onClose={onClose} ariaLabel={`Media, files and links in ${label}`}>
      <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
        <ImageIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold">Media, files and links</div>
          <p className="text-[13px] text-muted-foreground">{chat?.title ?? 'This chat'}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Close media, files and links"
          onClick={onClose}
          className="shrink-0 rounded-full text-muted-foreground"
        >
          <X className="size-5" aria-hidden="true" />
        </Button>
      </header>

      <div className="shrink-0 px-4 pt-3">
        <SegmentedControl
          options={TABS}
          value={tab}
          onChange={(value) => selectTab(value as MediaTab)}
          ariaLabel="Media tabs"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-4">
        <MediaBody
          key={`${chatId}|${tab}`}
          chatId={chatId}
          tab={tab}
          jump={jump}
          onRetry={() => setJumpFailed(false)}
        />
        {jumpFailed && (
          <p role="alert" className="px-2 text-[13px] text-danger">
            Message not found
          </p>
        )}
      </div>
    </Sheet>
  );
}
