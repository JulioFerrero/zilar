import { ChevronLeft } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GroupAisList } from '@/components/group-info/ais-list';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import type { GroupAi } from '@/lib/chat-api';
import { ICON } from '@/lib/colors';

type AisPageProps = {
  groupId: string;
  ais: GroupAi[];
  isManager: boolean;
  onBack: () => void;
};

/**
 * The AIs page of a channel (T-1587): the root's back key and title, then the
 * same list the group's People and AIs page shows (T-1858). The group info
 * root no longer links here.
 */
export function AisPage({ groupId, ais, isManager, onBack }: AisPageProps) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="h-14 flex-row items-center gap-2 px-3">
        <IconButton label="Back" onPress={onBack}>
          <ChevronLeft size={18} color={ICON} />
        </IconButton>
        <Text className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">AIs</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <GroupAisList groupId={groupId} ais={ais} isManager={isManager} />
      </ScrollView>
    </SafeAreaView>
  );
}
