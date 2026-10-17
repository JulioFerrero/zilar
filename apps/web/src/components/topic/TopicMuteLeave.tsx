import { isTopicJoined, type ChatSummary } from '@zilar/chat-core';
import { Bell, LogOut } from 'lucide-react';
import { useState } from 'react';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { ConfirmDialog } from '../ConfirmDialog';
import { ListRow } from '../ui/list-row';
import { Switch } from '../ui/switch';

const MUTE_FAILED = 'Could not change the mute. Try again.';

/**
 * T-1797: the bottom group of the topic panel (WebTopic.dc.html:113-124): a
 * Mute switch on the chat row's pref and one Leave topic row (never on
 * General), confirmed before the panel's existing leave action runs.
 */
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
  const storeApi = useChatStoreApi();
  const currentUserId = useChatSelector((s) => s.currentUserId);
  const [confirming, setConfirming] = useState(false);
  const [muteState, toggleMute] = useAction<void, void, ApiFailure>(() =>
    // Muted = mute forever; unmuted = clear, like the channel bar.
    fromApi(() => storeApi.getState().setMuted(chat.id, chat.muted ? null : 'forever')),
  );
  const busy = isWaiting(muteState);
  const failed = !busy && failureOf(muteState) !== undefined;
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
            checked={chat.muted}
            onCheckedChange={() => toggleMute()}
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
      {failed && (
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
