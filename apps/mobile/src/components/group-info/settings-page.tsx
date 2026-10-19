import type { ListenerEagerness, PatchGroupPayload } from '@zilar/api-contract';
import { Effect } from 'effect';
import { Eye, Lock } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';
import { AVATAR_EXPORT_SIDE, createAvatarFileUploader } from '@/components/settings/avatar-native';
import { AvatarControl, usePictureEditor } from '@/components/settings/avatar-control';
import { friendlyAvatarError } from '@/components/settings/profile-logic';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import type { GroupDetail } from '@/lib/chat-api';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { getSessionToken } from '@/lib/session-token';
import { useChatStore } from '@/store/chat-store-provider';
import { failureOf } from '@zilar/client-core';

type GroupListenerInfo = NonNullable<GroupDetail['listener']>;

const SAVE_ERROR = 'Could not save the picture. Try again.';
const REMOVE_ERROR = 'Could not remove the picture. Try again.';

function groupAvatarSlot(groupId: string): string {
  return `${API_URL}/api/avatars/group/${encodeURIComponent(groupId)}`;
}

type SettingsPageProps = {
  groupId: string;
  title: string;
  avatarUrl: string | undefined;
  membersCanCreateTopics: boolean;
  listener: GroupListenerInfo | undefined;
  isManager: boolean;
  isOwner: boolean;
  onBack: () => void;
  onOpenVisibility: () => void;
};

const WRITE_ERROR = 'Could not save the setting. Try again.';

export function SettingsPage({
  groupId,
  title,
  avatarUrl,
  membersCanCreateTopics,
  listener,
  isManager,
  isOwner,
  onBack,
  onOpenVisibility,
}: SettingsPageProps) {
  const patchGroupSettings = useChatStore((state) => state.patchGroupSettings);
  const refreshGroupDetail = useChatStore((state) => state.refreshGroupDetail);
  const reloadChats = useChatStore((state) => state.reloadChats);

  const onPictureChanged = () => {
    refreshGroupDetail(groupId);
    reloadChats();
  };

  const [token, setToken] = useState<string | undefined>(undefined);
  // The url a write just produced; null until then, so the detail's url wins.
  const [changedUrl, setChangedUrl] = useState<string | undefined | null>(null);

  useEffect(() => {
    let alive = true;
    getSessionToken()
      .then((next) => {
        if (alive) {
          setToken(next);
        }
      })
      .catch(() => {
        // No bearer: the picture falls back to the initials.
      });
    return () => {
      alive = false;
    };
  }, []);

  // The bearer already loaded, else one fresh read; a failure reads as none.
  const readToken = (): Promise<string | undefined> => getSessionToken().catch(() => undefined);

  const picture = usePictureEditor({
    upload: async (picked, onProgress) => {
      const bearer = await readToken();
      if (bearer === undefined) throw new Error(SAVE_ERROR);
      try {
        const uploaded = await createAvatarFileUploader().upload(
          groupAvatarSlot(groupId),
          {
            uri: picked.uri,
            mimeType: picked.mimeType,
            width: AVATAR_EXPORT_SIDE,
            height: AVATAR_EXPORT_SIDE,
          },
          bearer,
          onProgress,
        );
        return { url: uploaded.url };
      } catch (cause) {
        throw new Error(friendlyAvatarError(cause));
      }
    },
    remove: async () => {
      const bearer = await readToken();
      if (bearer === undefined) throw new Error(REMOVE_ERROR);
      try {
        const response = await fetch(groupAvatarSlot(groupId), {
          method: 'DELETE',
          credentials: 'omit',
          headers: { authorization: `Bearer ${bearer}` },
        });
        if (!response.ok) {
          throw new Error(REMOVE_ERROR);
        }
      } catch {
        throw new Error(REMOVE_ERROR);
      }
    },
    onChanged: (url) => {
      setChangedUrl(url);
      onPictureChanged();
    },
  });

  const [write, runWrite] = useAction((patch: PatchGroupPayload) =>
    Effect.tryPromise({
      try: () => patchGroupSettings(groupId, patch),
      catch: () => WRITE_ERROR,
    }),
  );
  const busy = isWaiting(write);
  const error = !busy && failureOf(write) !== undefined ? WRITE_ERROR : '';

  const listenerEnabled = listener?.enabled === true;
  const listenerAvailable = listener?.available === true;
  const eagerness: ListenerEagerness = listener?.eagerness ?? 'normal';

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScreenHeader variant="sub" title="Settings" onBack={onBack} />

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="gap-3 px-4 pt-1">
          {isManager ? (
            <AvatarControl
              ownerId={groupId}
              ownerName={title}
              currentUrl={changedUrl !== null ? changedUrl : avatarUrl}
              token={token}
              phase={picture.phase}
              busy={picture.busy}
              onPick={picture.pick}
              onSavePicked={picture.savePicked}
              onRemove={picture.remove}
            />
          ) : null}

          {isManager ? (
            <View className="gap-3 rounded-xl border border-border bg-surface px-3 py-3">
              <Switch
                label="Members can create topics"
                value={membersCanCreateTopics}
                disabled={busy}
                onValueChange={(value) => runWrite({ membersCanCreateTopics: value })}
              />

              <View className="gap-2">
                <View className="flex-row items-center gap-2">
                  <View className="min-w-0 flex-1">
                    <Switch
                      label="AI listener"
                      value={listenerEnabled}
                      disabled={!listenerAvailable || busy}
                      onValueChange={(value) => runWrite({ listenerEnabled: value })}
                    />
                  </View>
                  {listenerAvailable ? null : (
                    <View accessibilityLabel="Turned off on this server">
                      <Lock size={15} color={MUTED_FOREGROUND} />
                    </View>
                  )}
                </View>

                {listenerEnabled ? (
                  <SegmentedControl
                    options={[
                      { value: 'quiet', label: 'Quiet' },
                      { value: 'normal', label: 'Normal' },
                      { value: 'eager', label: 'Eager' },
                    ]}
                    value={eagerness}
                    onChange={(value) =>
                      runWrite({ listenerEagerness: value as ListenerEagerness })
                    }
                    accessibilityLabel="Eagerness"
                    mode="radio"
                  />
                ) : null}
              </View>
            </View>
          ) : null}

          {isOwner ? (
            <InfoRowGroup>
              <InfoRow icon={Eye} label="Visibility" onPress={onOpenVisibility} />
            </InfoRowGroup>
          ) : null}

          {error !== '' ? (
            <Text accessibilityRole="alert" className="text-[14px] text-danger">
              {error}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
