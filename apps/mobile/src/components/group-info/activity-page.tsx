import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AiActivity } from '@/components/ais/ai-activity';
import { makeAuditApi } from '@zilar/client-core';
import { useApi } from '@/lib/use-mockable-api';
import { ScreenHeader } from '@/components/ui/screen-header';

export function ActivityPage({ groupId, onBack }: { groupId: string; onBack: () => void }) {
  const { api } = useApi(makeAuditApi);
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScreenHeader variant="sub" title="Activity" onBack={onBack} />

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="px-4 pt-1">
          <AiActivity api={api} groupId={groupId} showHeader={false} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
