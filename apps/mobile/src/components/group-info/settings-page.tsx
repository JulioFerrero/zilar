import type { ListenerEagerness, PatchGroupPayload } from '@zilar/api-contract';
import { Effect } from 'effect';
import { Eye, Lock } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';
import { useGroupPicture } from '@/components/group-info/use-group-picture';
import { AvatarControl } from '@/components/settings/avatar-control';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import type { GroupDetail } from '@/lib/chat-api';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStore } from '@/store/chat-store-provider';

type GroupListenerInfo = NonNullable<GroupDetail['listener']>;

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

  const picture = useGroupPicture(groupId, avatarUrl, () => {
    refreshGroupDetail(groupId);
    reloadChats();
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
              currentUrl={picture.shownUrl}
              token={picture.token}
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
