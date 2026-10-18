import { type UiMessage } from '@zilar/chat-core';
import { EntityAvatar } from '../EntityAvatar';
import { cn } from '@/lib/utils';

export function MessageTombstone({
  message,
  own,
  showAvatarSlot,
  firstInGroup,
  lastInGroup,
}: {
  message: UiMessage;
  own: boolean;
  showAvatarSlot: boolean;
  firstInGroup: boolean;
  lastInGroup: boolean;
}) {
  return (
    <div
      data-message-id={message.id}
      className={cn(
        'group relative flex items-end gap-1.5',
        own ? 'flex-row-reverse' : 'flex-row',
        firstInGroup ? 'mt-2' : 'mt-0.5',
      )}
    >
      {showAvatarSlot &&
        (lastInGroup ? (
          <EntityAvatar person={{ id: message.senderId, name: message.senderName }} size={34} />
        ) : (
          <span className="w-[34px] shrink-0" aria-hidden="true" />
        ))}
      <div className={cn('flex min-w-0 flex-col', own ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'tombstone rounded-[14px] px-3 py-1.5 text-[13px] italic',
            own ? 'rounded-br-[4px]' : 'rounded-bl-[4px]',
          )}
        >
          {own ? 'You deleted this message' : 'This message was deleted'}
        </div>
      </div>
    </div>
  );
}
