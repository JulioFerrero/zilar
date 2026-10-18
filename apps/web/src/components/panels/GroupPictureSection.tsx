import { useState } from 'react';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { AvatarUploader } from '../AvatarUploader';

export function GroupPictureSection({
  groupId,
  title,
  currentUrl,
  chatId,
}: {
  groupId: string;
  title: string;
  currentUrl?: string | undefined;
  chatId: string;
}) {
  const storeApi = useChatStoreApi();
  const [changedUrl, setChangedUrl] = useState<string | undefined | null>(null);
  const shown = changedUrl !== null ? changedUrl : currentUrl;
  return (
    <AvatarUploader
      kind="group"
      ownerId={groupId}
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
