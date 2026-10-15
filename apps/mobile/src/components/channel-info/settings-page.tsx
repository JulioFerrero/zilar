import { ChevronLeft, Eye } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';

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
      <View className="h-14 flex-row items-center gap-2 px-3">
        <IconButton label="Back" onPress={onBack}>
          <ChevronLeft size={18} color={ICON} />
        </IconButton>
        <Text className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">
          Settings
        </Text>
      </View>

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
