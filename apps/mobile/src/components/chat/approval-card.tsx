import type { ApprovalRequest } from '@galena/protocol';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { formatMoney } from '@/lib/chat';

/** Title, summary, cost and Approve / Deny buttons. Static for now. */
export function ApprovalCard({ data }: { data: ApprovalRequest }) {
  return (
    <View className="min-w-[230px] gap-2 py-0.5">
      <Text className="text-[15px] font-semibold text-foreground">{data.action}</Text>
      <Text className="text-[13px] leading-4 text-muted-foreground">{data.summary}</Text>
      {data.worst_case_cost ? (
        <Text className="text-[13px] text-muted-foreground">
          Max cost: {formatMoney(data.worst_case_cost)}
        </Text>
      ) : null}
      <View className="flex-row gap-2">
        <Button
          size="sm"
          className="flex-1"
          onPress={() => console.log(`approval ${data.id}: approve`)}
        >
          <Text>Approve</Text>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 active:bg-list-hover"
          onPress={() => console.log(`approval ${data.id}: deny`)}
        >
          <Text>Deny</Text>
        </Button>
      </View>
    </View>
  );
}
