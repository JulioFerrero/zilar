import { Eye } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';
import { ScreenHeader } from '@/components/ui/screen-header';

type ChannelSettingsPageProps = {
  onBack: () => void;
  onOpenVisibility: () => void;
};

/**
 * The Settings page of a channel (T-1587), after web's channel panel
 * (`ChannelPanel.tsx:326-334`): the owner's Visibility row, which opens the
 * shared group visibility sheet. A channel has no other setting.
 */
export function ChannelSettingsPage({ onBack, onOpenVisibility }: ChannelSettingsPageProps) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScreenHeader variant="sub" title="Settings" onBack={onBack} />

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="gap-3 px-4 pt-1">
          <InfoRowGroup>
            <InfoRow icon={Eye} label="Visibility" onPress={onOpenVisibility} />
          </InfoRowGroup>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
