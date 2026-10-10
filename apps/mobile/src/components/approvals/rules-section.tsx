import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import type { ApprovalRule } from '@/lib/approvals-api';

import { AlwaysAllowedRow } from './always-allowed-row';
import type { LoadStatus, OwnedRule } from './use-approvals';

export function RulesSection({
  status,
  sections,
  error,
  nameFor,
  onAsk,
  onRetry,
}: {
  status: LoadStatus;
  sections: { aiId: string; rules: ApprovalRule[] }[];
  error: string;
  nameFor: (aiId: string) => string;
  onAsk: (owned: OwnedRule) => void;
  onRetry: () => void;
}) {
  const count = sections.reduce((total, section) => total + section.rules.length, 0);
  return (
    <View className="mt-6 gap-2 border-t border-divider pt-4">
      <Text className="text-[16px] font-semibold">Always allowed</Text>
      {status === 'loading' ? <StateMessage kind="loading" size="inline" title="Loading…" /> : null}
      {status === 'error' ? (
        <View className="gap-2">
          <Text accessibilityRole="alert" className="text-[14px] text-danger">
            {error}
          </Text>
          <Button variant="outline" size="sm" className="self-start" onPress={onRetry}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : null}
      {status === 'ready' && count === 0 ? (
        <Text className="text-[13px] text-muted-foreground">Nothing is always allowed here.</Text>
      ) : null}
      {status === 'ready' && count > 0
        ? sections.map((section) => (
            <View key={section.aiId} className="gap-1">
              <Text className="text-[13px] font-medium text-muted-foreground">
                {nameFor(section.aiId)}
              </Text>
              {section.rules.map((rule) => (
                <AlwaysAllowedRow
                  key={rule.id}
                  rule={rule}
                  confirming={false}
                  revoking={false}
                  onAsk={() => onAsk({ aiId: section.aiId, rule })}
                  onCancel={() => {}}
                  onConfirm={() => {}}
                />
              ))}
            </View>
          ))
        : null}
    </View>
  );
}
