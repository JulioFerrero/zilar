import { isTopicJoined, type ChatSummary } from '@zilar/chat-core';
import { Bell, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { ConfirmDialog } from '../ConfirmDialog';
import { ListRow } from '../ui/list-row';
import { Switch } from '../ui/switch';
import { useMuteToggle } from '../useMuteToggle';

const MUTE_FAILED = 'Could not change the mute. Try again.';

export function TopicMuteLeave({
  chat,
  groupTitle,
  leaving,
  onLeave,
}: {
  chat: ChatSummary;
  groupTitle: string;
  leaving: boolean;
  onLeave: () => void;
}) {
  const currentUserId = useChatSelector((s) => s.currentUserId);
  const [confirming, setConfirming] = useState(false);
  const { muted, busy, error, toggle } = useMuteToggle(chat);
  const topic = chat.topic;

  if (topic === undefined) {
    return null;
  }

  return (
    <section aria-label="Topic settings" className="flex flex-col gap-1">
      <ListRow
        icon={<Bell className="size-4" aria-hidden="true" />}
        title="Mute"
        trailing={
          <Switch
            checked={muted}
            onCheckedChange={() => toggle()}
            label={`Mute ${chat.title}`}
            hideLabel
            disabled={busy}
          />
        }
      />
      {topic.isGeneral !== true && isTopicJoined(topic, currentUserId) && (
        <ListRow
          danger
          icon={<LogOut className="size-4" aria-hidden="true" />}
          title={leaving ? 'Leaving…' : 'Leave topic'}
          {...(leaving ? {} : { onClick: () => setConfirming(true) })}
        />
      )}
      {error !== undefined && (
        <p role="alert" className="px-2 text-[12px] text-danger">
          {MUTE_FAILED}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title={`Leave ${chat.title}?`}
          body={
            topic.visibility === 'private'
              ? 'Someone in it has to add you back.'
              : `You stop getting its messages. You can join again from ${groupTitle}.`
          }
          confirmLabel="Leave topic"
          onConfirm={() => {
            setConfirming(false);
            onLeave();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
