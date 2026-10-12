import { useState } from 'react';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { AvatarUploader } from '../AvatarUploader';

/**
 * The group's picture (T-0165), for owners and admins. Refreshes the
 * group's chats from the server after a change (the uploader reports the
 * new url or undefined), so the list and header show it at once.
 */
export function GroupPictureSection({
  groupId,
  title,
  currentUrl,
  chatId,
  generalRoomJid,
}: {
  groupId: string;
  title: string;
  currentUrl?: string | undefined;
  chatId: string;
  /** T-1209: the General topic's room JID (the group's ball seed). */
  generalRoomJid?: string | undefined;
}) {
  const storeApi = useChatStoreApi();
  // The uploader reports the new url (or undefined after a remove) through
  // `onChanged`; while no change happened this render, the server row wins.
  const [changedUrl, setChangedUrl] = useState<string | undefined | null>(null);
  const shown = changedUrl !== null ? changedUrl : currentUrl;
  return (
    <AvatarUploader
      kind="group"
      ownerId={groupId}
      ownerSeed={generalRoomJid ?? chatId}
      ownerName={title}
      currentUrl={shown}
      onChanged={(next) => {
        setChangedUrl(next);
        storeApi.getState().refreshChats();
        storeApi.getState().refreshGroupInfo(chatId);
      }}
    />
  );
}
