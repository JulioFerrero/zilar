import { ChevronLeft } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AiActivity } from '@/components/ais/ai-activity';
import { useAuditApi } from '@/components/ais/use-audit-api';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';

/**
 * The Activity page of Group info (T-1573), after the web group panel: the
 * group's audit rows, read only. It reuses the AI screen's list (`AiActivity`)
 * with a group scope; the page's own 28 px title replaces the section heading.
 */
export function ActivityPage({ groupId, onBack }: { groupId: string; onBack: () => void }) {
  const { api } = useAuditApi();
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="h-14 flex-row items-center gap-2 px-3">
        <IconButton label="Back" onPress={onBack}>
          <ChevronLeft size={18} color={ICON} />
        </IconButton>
        <Text className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">
          Activity
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="px-4 pt-1">
          <AiActivity api={api} groupId={groupId} showHeader={false} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
